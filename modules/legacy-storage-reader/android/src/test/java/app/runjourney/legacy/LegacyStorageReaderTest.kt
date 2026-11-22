package app.runjourney.legacy

import android.content.Context
import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import org.junit.Assert.*
import org.junit.Test
import org.junit.BeforeClass
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.nio.file.StandardCopyOption

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 33, 35])
class LegacyStorageReaderTest {
  companion object {
    @JvmStatic @BeforeClass fun isolateHostNativeLibraryForRobolectricSandbox() {
      // JNI libraries belong to one classloader. Robolectric uses a separate
      // sandbox per SDK; use an identical binary at a distinct test-only path.
      val source = File(requireNotNull(System.getProperty("legacy.sqlite.host.source")))
      val directory = File(source.parentFile, "sandbox-api-${Build.VERSION.SDK_INT}").apply { mkdirs() }
      Files.copy(source.toPath(), File(directory, source.name).toPath(), StandardCopyOption.REPLACE_EXISTING)
      System.setProperty("androidx.sqlite.driver.bundled.path", directory.absolutePath)
    }
  }
  private fun temporary(block: (Context, File) -> Unit) {
    val root = Files.createTempDirectory("synthetic-legacy-storage").toFile()
    val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
      override fun getDatabasePath(name: String): File { require(name == "RKStorage"); return File(root, name) }
    }
    try { block(context, File(root, "RKStorage")) } finally { root.deleteRecursively() }
  }
  private fun fixture(file: File): SQLiteDatabase = SQLiteDatabase.openOrCreateDatabase(file, null).also {
    it.disableWriteAheadLogging()
    it.execSQL("CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT)")
  }
  private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun digestFiles(file: File) = listOf("", "-wal", "-shm").associateWith { suffix -> File(file.path + suffix).takeIf { it.isFile }?.readBytes()?.let(::sha) }
  private fun assertSourceContentsUnchanged(before: Map<String, String?>, file: File) {
    val after = digestFiles(file)
    assertEquals(before[""], after[""])
    if (before["-wal"] != null) assertEquals(before["-wal"], after["-wal"])
    else assertTrue(!File(file.path + "-wal").exists() || File(file.path + "-wal").length() == 0L)
  }
  /** Synthetic fixtures only: snapshot a committed WAL before the fixture
   * writer closes/checkpoints. The production reader never copies any files. */
  private fun walFixtureWithoutIndex(file: File, uncommittedTail: Boolean = false) {
    val source = File(file.parentFile, "synthetic-writer.sqlite")
    fixture(source).use { writer ->
      assertTrue(writer.enableWriteAheadLogging())
      writer.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/value','committed')")
      if (uncommittedTail) {
        writer.execSQL("PRAGMA cache_size=2")
        writer.beginTransaction()
        writer.execSQL("UPDATE catalystLocalStorage SET value='uncommitted' WHERE key='@runjourney/value'")
        writer.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/uncommitted', replace(hex(zeroblob(100000)), '0', 'x'))")
      }
      try {
        Files.copy(source.toPath(), file.toPath())
        Files.copy(File(source.path + "-wal").toPath(), File(file.path + "-wal").toPath())
      } finally { if (uncommittedTail) writer.endTransaction() }
    }
    assertTrue(File(file.path + "-wal").length() > 0)
    assertFalse(File(file.path + "-shm").exists())
  }
  private fun reject(block: () -> Unit) { try { block(); fail("Expected closed failure") } catch (_: Exception) { } }
  @Suppress("UNCHECKED_CAST")
  private fun entries(opened: Map<String, Any?>) = opened["entries"] as List<Map<String, Any>>

  @Test fun absentSourceDoesNotCreateAnything() = temporary { context, file ->
    val reader = LegacyStorageReader(context)
    val result = reader.open()
    assertNull(result["token"]); assertTrue(entries(result).isEmpty()); assertFalse(file.exists())
  }

  @Test fun multiMegabyteValueAndEmojiAreChunkedAndOriginalUtf8HashMatches() = temporary { context, file ->
    val value = "x".repeat(16383) + "😀" + "あ🚲".repeat(600000)
    assertTrue(value.toByteArray(Charsets.UTF_8).size > 2 * 1024 * 1024)
    fixture(file).use { database ->
      database.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/runs/v1", value))
      database.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@other/private", "must-not-export"))
    }
    val before = digestFiles(file)
    val reader = LegacyStorageReader(context)
    val opened = reader.open(); val metadata = entries(opened).single()
    assertEquals(value.codePointCount(0, value.length), metadata["length"])
    assertEquals(sha(value.toByteArray(Charsets.UTF_8)), metadata["sha256"])
    val token = opened["token"] as String
    val restored = StringBuilder(); var offset = 0
    while (true) {
      val chunk = reader.read(token, "@runjourney/runs/v1", offset)
      val text = chunk["text"] as String
      assertTrue(text.codePointCount(0, text.length) <= LegacyStorageReader.CHUNK_CODEPOINTS)
      assertFalse(text.isNotEmpty() && Character.isHighSurrogate(text.last()))
      assertFalse(text.isNotEmpty() && Character.isLowSurrogate(text.first()))
      restored.append(text); offset = chunk["nextOffset"] as Int
      if (chunk["done"] == true) break
    }
    assertEquals(value, restored.toString()); reader.close(token)
    assertEquals(before, digestFiles(file))
  }

  @Test fun corruptSourceAndBadSchemaFailWithoutDefaultDeletionOrRepair() = temporary { context, file ->
    file.writeBytes("synthetic not sqlite".toByteArray()); val original = file.readBytes()
    reject { LegacyStorageReader(context).open() }
    assertTrue(file.exists()); assertArrayEquals(original, file.readBytes())
    file.delete() // synthetic fixture only
    SQLiteDatabase.openOrCreateDatabase(file, null).use { it.execSQL("CREATE TABLE unrelated (x)") }
    val hash = sha(file.readBytes()); reject { LegacyStorageReader(context).open() }
    assertEquals(hash, sha(file.readBytes()))
  }

  @Test fun sourceValuesMustBeTextAndWithinNamespaceAndSizeLimits() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/bad", byteArrayOf(1, 2))) }
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertSourceContentsUnchanged(before, file)
  }

  @Test fun tooManyKeysAreRejectedBeforeAnyFullValuesAreRead() = temporary { context, file ->
    fixture(file).use { db ->
      db.beginTransaction()
      try { repeat(513) { db.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/key$it", "x")) }; db.setTransactionSuccessful() }
      finally { db.endTransaction() }
    }
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertSourceContentsUnchanged(before, file)
  }

  @Test fun overlongKeyNulAndOversizeValueFailClosed() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/" + "k".repeat(256), "x")) }
    reject { LegacyStorageReader(context).open() }
    SQLiteDatabase.openDatabase(file.path, null, 0).use { it.execSQL("DELETE FROM catalystLocalStorage"); it.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/nul", "x\u0000y")) }
    reject { LegacyStorageReader(context).open() }
    SQLiteDatabase.openDatabase(file.path, null, 0).use { it.execSQL("DELETE FROM catalystLocalStorage"); it.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/big', replace(hex(zeroblob(16777217)), '0', 'x'))") }
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertSourceContentsUnchanged(before, file)
  }

  @Test fun tokenKeyOffsetSingleSessionAndExpiryAreEnforced() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/empty','')") }
    var now = 1000L
    val reader = LegacyStorageReader(context) { now }
    val token = reader.open()["token"] as String
    reject { reader.open() }; reject { reader.read("wrong", "@runjourney/empty", 0) }
    reject { reader.read(token, "@other/private", 0) }; reject { reader.read(token, "@runjourney/empty", -1) }
    assertEquals(mapOf("text" to "", "nextOffset" to 0, "done" to true), reader.read(token, "@runjourney/empty", 0))
    now += LegacyStorageReader.SESSION_MS
    reject { reader.read(token, "@runjourney/empty", 0) }
    val next = reader.open()["token"] as String
    assertNotEquals(token, next); reader.close(next)
  }

  @Test fun walReadMaintainsOneSnapshotAndDoesNotChangeMainOrWalBytes() = temporary { context, file ->
    fixture(file).use { writer ->
      assertTrue(writer.enableWriteAheadLogging())
      writer.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/value','before')")
      val original = digestFiles(file)
      val reader = LegacyStorageReader(context); val token = reader.open()["token"] as String
      writer.execSQL("UPDATE catalystLocalStorage SET value='after' WHERE key='@runjourney/value'")
      val afterWriter = digestFiles(file)
      assertEquals("before", reader.read(token, "@runjourney/value", 0)["text"])
      reader.close(token)
      val afterReader = digestFiles(file)
      assertEquals(afterWriter[""], afterReader[""]); assertEquals(afterWriter["-wal"], afterReader["-wal"])
      assertEquals(original[""], afterReader[""])
      // SHM read marks are managed by SQLite, not application writes. Main DB
      // and WAL contents must be invariant across the reader's lifecycle.
    }
  }

  @Test fun olderAndroidReadsSameSnapshotWithoutChangingSource() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/value','legacy')") }
    val before = digestFiles(file)
    val reader = LegacyStorageReader(context); val token = reader.open()["token"] as String
    assertEquals("legacy", reader.read(token, "@runjourney/value", 0)["text"])
    reader.close(token)
    assertEquals(before, digestFiles(file))
  }

  @Test fun malformedBlobKeyIsNotSilentlySkippedAsAnEmptyLegacyStore() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/blob-key".toByteArray(), "value")) }
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertEquals(before, digestFiles(file))
  }

  @Test fun committedWalWithoutIndexIsReadWithoutChangingExistingMainOrWal() = temporary { context, file ->
    walFixtureWithoutIndex(file)
    val before = digestFiles(file)
    val reader = LegacyStorageReader(context); val token = reader.open()["token"] as String
    assertEquals("committed", reader.read(token, "@runjourney/value", 0)["text"])
    reader.close(token)
    val after = digestFiles(file)
    assertEquals(before[""], after[""]); assertEquals(before["-wal"], after["-wal"])
  }

  @Test fun driverReadOnlyFlagRejectsActualWritesAndDoesNotModifySource() = temporary { _, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/value','original')") }
    val before = digestFiles(file)
    BundledSQLiteDriver().open(file.path, SQLITE_OPEN_READONLY).use { connection ->
      connection.prepare("BEGIN DEFERRED").use { it.step() }
      reject { connection.prepare("UPDATE catalystLocalStorage SET value='forbidden'").use { it.step() } }
      connection.prepare("ROLLBACK").use { it.step() }
    }
    assertEquals(before, digestFiles(file))
  }

  @Test fun closedCleanWalHeaderWithoutSidecarsIsReadAndOnlyEngineRuntimeFilesMayAppear() = temporary { context, file ->
    fixture(file).use { db ->
      assertTrue(db.enableWriteAheadLogging())
      db.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/value','closed-wal')")
    }
    assertFalse(File(file.path + "-wal").exists()); assertFalse(File(file.path + "-shm").exists())
    val before = digestFiles(file)
    val reader = LegacyStorageReader(context); val token = reader.open()["token"] as String
    assertEquals("closed-wal", reader.read(token, "@runjourney/value", 0)["text"])
    reader.close(token)
    val after = digestFiles(file)
    assertEquals(before[""], after[""])
    assertTrue(!File(file.path + "-wal").exists() || File(file.path + "-wal").length() == 0L)
  }

  @Test fun crashLikeUncommittedWalTailDoesNotBecomeVisibleOrGetRepaired() = temporary { context, file ->
    walFixtureWithoutIndex(file, uncommittedTail = true)
    val before = digestFiles(file)
    val reader = LegacyStorageReader(context); val opened = reader.open(); val token = opened["token"] as String
    assertEquals("@runjourney/value", entries(opened).single()["key"])
    assertEquals("committed", reader.read(token, "@runjourney/value", 0)["text"])
    reader.close(token)
    val after = digestFiles(file)
    assertEquals(before[""], after[""]); assertEquals(before["-wal"], after["-wal"])
  }

  @Test fun unavailableShmCreationFailsClosedAndDoesNotChangeExistingMainOrWal() = temporary { context, file ->
    walFixtureWithoutIndex(file)
    assertTrue(File(file.path + "-shm").mkdir()) // Synthetic filesystem creation failure.
    val before = digestFiles(file)
    reject { LegacyStorageReader(context).open() }
    val after = digestFiles(file)
    assertEquals(before[""], after[""]); assertEquals(before["-wal"], after["-wal"])
    assertTrue(File(file.path + "-shm").isDirectory)
  }

  @Test fun unavailableWalCreationFailsClosedWithoutChangingMainData() = temporary { context, file ->
    fixture(file).use { db ->
      assertTrue(db.enableWriteAheadLogging())
      db.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/value','unavailable-sidecar')")
    }
    assertTrue(File(file.path + "-wal").mkdir()) // Synthetic creation/write failure.
    val before = digestFiles(file)
    reject { LegacyStorageReader(context).open() }
    assertEquals(before[""], digestFiles(file)[""])
    assertTrue(File(file.path + "-wal").isDirectory)
  }
}
