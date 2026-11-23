package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.io.File

class VoiceLogJournalTest {
  private fun temporary(test: (File) -> Unit) {
    val root = Files.createTempDirectory("voice-journal-test").toFile()
    try { test(root) } finally { root.deleteRecursively() }
  }
  @Test fun appendPreviewAndReloadPreserveUtf8AndOrder() = temporary { dir ->
    val store = VoiceLogJournal(dir)
    for (i in 0..699) store.append("{\"id\":$i,\"message\":\"停止を確認しています。\"}", 1000L + i)
    val preview = store.read(12, 2000)
    assertTrue(preview.startsWith("[{\"id\":688,")); assertTrue(preview.endsWith("\"停止を確認しています。\"}]"))
    assertEquals(store.read(20000, 2000), VoiceLogJournal(dir).read(20000, 2000))
    assertTrue(store.read(20000, 2000).contains("\"id\":0,"))
  }
  @Test fun twoAndHalfHoursKeepEveryEventBeyondOld512Cap() = temporary { dir ->
    val store = VoiceLogJournal(dir)
    for (i in 0 until 900) store.append("{\"id\":$i,\"data\":\"${"数".repeat(700)}\"}", i.toLong())
    val result = VoiceLogJournal(dir).read(20000, 1000)
    assertTrue(result.startsWith("[{\"id\":0,")); assertTrue(result.contains("\"id\":899,"))
    assertEquals(900, Regex("\\\"id\\\":").findAll(result).count())
  }
  @Test fun largeRunIsBoundedBy20MillionBytesAcrossRestart() = temporary { dir ->
    val store = VoiceLogJournal(dir)
    val payload = "あ".repeat(1000)
    for (i in 0 until 8000) store.append("{\"id\":$i,\"data\":\"$payload\"}", i.toLong())
    val bytes = dir.listFiles()!!.sumOf { it.length() }
    assertTrue(bytes <= 20_000_000); assertTrue(bytes > 19_000_000)
    val result = VoiceLogJournal(dir).read(20000, 9000)
    assertFalse(result.contains("\"id\":0,")); assertTrue(result.contains("\"id\":7999,"))
    assertTrue(result.toByteArray(Charsets.UTF_8).size < 20_000_000)
  }
  @Test fun countLimitDropsOldestChunks() = temporary { dir ->
    val store = VoiceLogJournal(dir, maxCount = 100, chunkBytes = 1000)
    for (i in 0 until 250) store.append("{\"id\":$i}", i.toLong())
    val result = store.read(20000, 300)
    assertTrue(Regex("\\\"id\\\":").findAll(result).count() <= 100)
    assertTrue(result.contains("\"id\":249}")); assertFalse(result.contains("\"id\":0}"))
  }
  @Test fun expiryFiltersInsideMixedAgeChunk() = temporary { dir ->
    val store = VoiceLogJournal(dir, retentionMs = 100)
    store.append("{\"id\":1}", 10)
    store.append("{\"id\":2}", 90)
    assertEquals("[{\"id\":2}]", store.read(20, 150))
    assertEquals("[]", store.read(20, 201))
  }
  @Test fun interruptedAppendKeepsCompleteRecordsAndAllowsFurtherAppend() = temporary { dir ->
    VoiceLogJournal(dir).append("{\"id\":1}", 1)
    dir.listFiles()!!.single().appendText("2\t{\"id\":", Charsets.UTF_8)
    val restored = VoiceLogJournal(dir)
    assertEquals("[{\"id\":1}]", restored.read(20, 10))
    restored.append("{\"id\":3}", 3)
    assertEquals("[{\"id\":1},{\"id\":3}]", restored.read(20, 10))
  }
  @Test fun oversizedRecordAndMultilineDoNotDamageOldEntries() = temporary { dir ->
    val store = VoiceLogJournal(dir, chunkBytes = 100)
    store.append("{\"id\":1}", 1)
    try { store.append("x".repeat(101), 2); fail("oversize should fail") } catch (_: IllegalArgumentException) { }
    try { store.append("{\n}", 2); fail("multiline should fail") } catch (_: IllegalArgumentException) { }
    assertEquals("[{\"id\":1}]", store.read(20, 10))
  }
  @Test fun legacyMigrationIsIdempotentAndRecoversPartialStaging() = temporary { dir ->
    val target = File(dir, "journal")
    val staging = File(dir, "journal-migration")
    VoiceLogJournal(staging).append("{\"id\":99}", 99)
    VoiceLogJournal.migrateLegacy(target, { listOf(1L to "{\"id\":1}") }, 100)
    assertEquals("[{\"id\":1}]", VoiceLogJournal(target).read(20, 100))
    VoiceLogJournal.migrateLegacy(target, { throw IllegalStateException("must not re-import") }, 100)
    assertEquals("[{\"id\":1}]", VoiceLogJournal(target).read(20, 100))
  }
  @Test fun failedMigrationLeavesTargetAbsentForRetry() = temporary { dir ->
    val target = File(dir, "journal")
    try { VoiceLogJournal.migrateLegacy(target, { throw IllegalStateException("source unreadable") }, 100); fail() }
    catch (_: IllegalStateException) { }
    assertFalse(target.exists())
    VoiceLogJournal.migrateLegacy(target, { listOf(1L to "{\"id\":1}") }, 100)
    assertEquals("[{\"id\":1}]", VoiceLogJournal(target).read(20, 100))
  }
}
