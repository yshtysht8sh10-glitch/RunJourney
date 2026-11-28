package app.runjourney.legacy

import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class ActivityMetadataReaderTest {
  companion object {
    @JvmStatic @BeforeClass fun isolateDriver() {
      val source = File(requireNotNull(System.getProperty("legacy.sqlite.host.source")))
      val directory = File(source.parentFile, "sandbox-activity-metadata").apply { mkdirs() }
      Files.copy(source.toPath(), File(directory, source.name).toPath(), StandardCopyOption.REPLACE_EXISTING)
      System.setProperty("androidx.sqlite.driver.bundled.path", directory.absolutePath)
    }
  }
  private lateinit var root: File
  private lateinit var reader: ActivityMetadataReader
  @Before fun setup() {
    root = Files.createTempDirectory("synthetic-activity-metadata").toFile()
    val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) { override fun getFilesDir() = root }
    reader = ActivityMetadataReader(context)
  }
  @After fun cleanup() { root.deleteRecursively() } // Synthetic JVM sandbox only.
  private fun fixture(name: String = "runjourney.sqlite"): SQLiteDatabase {
    val file = File(File(root, "SQLite").apply { mkdirs() }, name)
    return SQLiteDatabase.openOrCreateDatabase(file, null).also {
      it.execSQL("PRAGMA user_version=2")
      it.execSQL("CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,started_at TEXT,ended_at TEXT,effective_distance REAL,effective_time REAL,trashed_at INTEGER)")
      it.execSQL("CREATE TABLE active_run(slot INTEGER,run_id TEXT)")
      // No GPS table: successful reads prove metadata does not depend on GPS materialization.
    }
  }
  private fun add(db: SQLiteDatabase, id: String, status: String = "completed", trash: Boolean = false) {
    db.execSQL("INSERT INTO runs VALUES (?,?, '2026-11-28T01:00:00Z', ?,100,10000,?)",
      arrayOf(id, status, if(status == "completed") "2026-11-28T01:00:10Z" else null, if(trash) 1 else null))
  }
  @Test fun missingFilesDoNotCreateSQLiteDirectory() {
    assertEquals(false, reader.read("running", "draft", 1, 0)["exists"])
    assertFalse(File(root, "SQLite").exists())
  }
  @Test fun independentSameIdHistoryExcludesTrashAndIsBounded() {
    fixture().use { add(it, "same"); add(it, "trash", trash=true) }
    fixture("runjourney-cycling.sqlite").use { add(it, "same") }
    val before = File(root, "SQLite/runjourney.sqlite").readBytes()
    assertEquals(1, (reader.read("running", "history", 1, 0)["rows"] as List<*>).size)
    assertEquals(1, (reader.read("cycling", "history", 1, 0)["rows"] as List<*>).size)
    assertTrue((reader.read("running", "history", 1, 1)["rows"] as List<*>).isEmpty())
    assertArrayEquals(before, File(root, "SQLite/runjourney.sqlite").readBytes())
  }
  @Test fun validDraftIsVisibleWithoutLoadingGPS() {
    fixture().use { add(it, "draft", "draft"); it.execSQL("INSERT INTO active_run VALUES(1,'draft')") }
    val rows = reader.read("running", "draft", 1, 0)["rows"] as List<*>
    assertEquals(1, rows.size)
  }
  @Test fun orphanDraftMustNotBecomeIdle() {
    fixture().use { add(it, "orphan", "draft") }
    try { reader.read("running", "draft", 1, 0); fail("Must reject orphan") } catch (_: IllegalStateException) { }
  }
  @Test fun corruptDatabaseIsPreserved() {
    val file = File(File(root, "SQLite").apply { mkdirs() }, "runjourney.sqlite").apply { writeText("synthetic corrupt") }
    val before = file.readBytes()
    try { reader.read("running", "draft", 1, 0); fail("Must reject corrupt source") } catch (_: Exception) { }
    assertArrayEquals(before, file.readBytes())
  }
  @Test fun unknownActivityOrLargePageIsRejectedBeforeRead() {
    try { reader.read("../runjourney.sqlite", "history", 1, 0); fail("Must reject path") } catch (_: IllegalStateException) { }
    try { reader.read("running", "history", 129, 0); fail("Must reject page") } catch (_: IllegalStateException) { }
    assertFalse(File(root, "SQLite").exists())
  }
  @Test fun noncanonicalOrExtraActiveSlotsMustNotBecomeIdle() {
    fixture().use { it.execSQL("INSERT INTO active_run VALUES(2,'orphan')") }
    try { reader.read("running", "draft", 1, 0); fail("Must reject noncanonical slot") } catch (_: IllegalStateException) { }
  }
  @Test fun pagesSortOffsetTimestampsByInstantWithoutChangingOriginalText() {
    fixture().use {
      it.execSQL("INSERT INTO runs VALUES('earlier','completed','2026-11-28T09:00:00+09:00','2026-11-28T09:00:10+09:00',1,10000,NULL)")
      it.execSQL("INSERT INTO runs VALUES('later','completed','2026-11-28T01:00:00Z','2026-11-28T01:00:10Z',1,10000,NULL)")
    }
    val rows = reader.read("running", "history", 1, 0)["rows"] as List<*>
    assertEquals("later", (rows[0] as Map<*,*>)["id"])
    val next = reader.read("running", "history", 1, 1)["rows"] as List<*>
    assertEquals("2026-11-28T09:00:00+09:00", (next[0] as Map<*,*>)["startedAt"])
  }
  @Test fun textNumbersAndInvalidDatesAreRejectedAndPreserved() {
    fixture().use { it.execSQL("INSERT INTO runs VALUES('bad','completed','not-a-date','2026-11-28T01:00:10Z','not-a-number',10000,NULL)") }
    val file = File(root, "SQLite/runjourney.sqlite"); val before = file.readBytes()
    try { reader.read("running", "history", 1, 0); fail("Must reject header") } catch (_: IllegalStateException) { }
    assertArrayEquals(before, file.readBytes())
  }
  @Test fun relativeNowCannotBeAcceptedAsAStoredAbsoluteDate() {
    fixture().use { it.execSQL("INSERT INTO runs VALUES('bad','completed','now','now',1,1,NULL)") }
    try { reader.read("running", "history", 1, 0); fail("Must reject now") } catch (_: IllegalStateException) { }
  }
  @Test fun timeOnlyCannotBeAcceptedAsAStoredAbsoluteDate() {
    fixture().use { it.execSQL("INSERT INTO runs VALUES('bad','completed','12:00:00','12:00:01',1,1,NULL)") }
    try { reader.read("running", "history", 1, 0); fail("Must reject time without date") } catch (_: IllegalStateException) { }
  }
}
