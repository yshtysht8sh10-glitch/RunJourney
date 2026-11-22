package app.runjourney.legacy

import android.content.Context
import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LegacyStorageReaderTest {
  private fun temporary(block: (Context, File) -> Unit) {
    val root = Files.createTempDirectory("synthetic-legacy-storage").toFile()
    val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
      override fun getDatabasePath(name: String): File { require(name == "RKStorage"); return File(root, name) }
    }
    try { block(context, File(root, "RKStorage")) } finally { root.deleteRecursively() }
  }
  private fun fixture(file: File): SQLiteDatabase = SQLiteDatabase.openOrCreateDatabase(file, null).also {
    it.execSQL("CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT)")
  }
  private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun digestFiles(file: File) = listOf("", "-wal", "-shm").associateWith { suffix -> File(file.path + suffix).takeIf { it.exists() }?.readBytes()?.let(::sha) }
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
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertEquals(before, digestFiles(file))
  }

  @Test fun tooManyKeysAreRejectedBeforeAnyFullValuesAreRead() = temporary { context, file ->
    fixture(file).use { db ->
      db.beginTransaction()
      try { repeat(513) { db.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/key$it", "x")) }; db.setTransactionSuccessful() }
      finally { db.endTransaction() }
    }
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertEquals(before, digestFiles(file))
  }

  @Test fun overlongKeyNulAndOversizeValueFailClosed() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/" + "k".repeat(256), "x")) }
    reject { LegacyStorageReader(context).open() }
    SQLiteDatabase.openDatabase(file.path, null, 0).use { it.execSQL("DELETE FROM catalystLocalStorage"); it.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/nul", "x\u0000y")) }
    reject { LegacyStorageReader(context).open() }
    SQLiteDatabase.openDatabase(file.path, null, 0).use { it.execSQL("DELETE FROM catalystLocalStorage"); it.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/big', replace(hex(zeroblob(16777217)), '0', 'x'))") }
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertEquals(before, digestFiles(file))
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

  @Test @Config(sdk = [28]) fun olderAndroidFailsClosedWithoutChangingSourceOrPretendingEmpty() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES ('@runjourney/value','legacy')") }
    val before = digestFiles(file)
    try { LegacyStorageReader(context).open(); fail("Expected unsupported transaction") }
    catch (error: IllegalStateException) { assertEquals("LEGACY_READ_TRANSACTION_UNSUPPORTED", error.message) }
    assertEquals(before, digestFiles(file))
  }

  @Test fun malformedBlobKeyIsNotSilentlySkippedAsAnEmptyLegacyStore() = temporary { context, file ->
    fixture(file).use { it.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf("@runjourney/blob-key".toByteArray(), "value")) }
    val before = digestFiles(file); reject { LegacyStorageReader(context).open() }; assertEquals(before, digestFiles(file))
  }

  @Test fun missingWalIndexFailsWithoutCreatingSharedMemoryFile() = temporary { context, file ->
    fixture(file).close()
    val wal = File(file.path + "-wal"); wal.writeText("synthetic incomplete WAL")
    val before = digestFiles(file)
    reject { LegacyStorageReader(context).open() }
    assertEquals(before, digestFiles(file)); assertFalse(File(file.path + "-shm").exists())
  }
}
