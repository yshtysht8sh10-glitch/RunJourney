package app.runjourney.announcer

import android.content.ContextWrapper
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import java.util.UUID
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class DetectorJournalTest {
  private val secret = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
  private val id = UUID.randomUUID().toString()
  private fun temporary(test: (File) -> Unit) {
    val root = Files.createTempDirectory("synthetic-detector-journal").toFile()
    try { test(root) } finally { root.deleteRecursively() }
  }
  private fun payload(seq: Int, kind: String = "INPUT", text: String = "synthetic-coordinate-placeholder") =
    JSONObject().put("seq", seq).put("kind", kind).put("data", text).toString()
  private fun assertRejected(block: () -> Unit) {
    try { block(); fail("Expected rejection") } catch (_: Exception) { }
  }
  @Test fun durableInputCounterChangesOnlyAfterSuccessfulInputAppend() = temporary { root ->
    val journal=DetectorJournalStorage.Journal(root,id,secret)
    val record=JSONObject().put("seq",0).put("kind","INPUT").put("data",JSONObject().put("raws",org.json.JSONArray().put(JSONObject()).put(JSONObject())))
    journal.append(record.toString(),1,1);assertEquals(2,journal.inputCount)
    assertRejected {journal.append(record.toString(),2,2)};assertEquals(2,journal.inputCount)
    journal.append(payload(1,"END"),3,3);journal.seal();assertEquals(2,journal.inputCount)
  }
  @Test fun encryptionUsesFreshNonceAuthenticatesSessionAndRejectsTamper() {
    val plain = payload(0)
    val one = JournalCipher.encrypt(secret, id, plain)
    val two = JournalCipher.encrypt(secret, id, plain)
    assertFalse(one.contentEquals(two)); assertFalse(String(one).contains("synthetic-coordinate-placeholder"))
    assertEquals(plain, JournalCipher.decrypt(secret, id, one))
    assertRejected { JournalCipher.decrypt(secret, "other-session", one) }
    one[one.lastIndex] = (one.last().toInt() xor 1).toByte()
    assertRejected { JournalCipher.decrypt(secret, id, one) }
  }
  @Test fun bufferBoundariesRefuseWithoutEvictingAcceptedRecords() {
    val count = JournalBufferBudget(DetectorJournalStorage.BUFFER_BYTES, DetectorJournalStorage.BUFFER_RECORDS)
    repeat(2048) { assertTrue(count.reserve(1)) }
    assertFalse(count.reserve(1)); assertEquals(2048, count.count); assertEquals(2048, count.bytes)
    val bytes = JournalBufferBudget(DetectorJournalStorage.BUFFER_BYTES, 2048)
    assertTrue(bytes.reserve(DetectorJournalStorage.BUFFER_BYTES)); assertFalse(bytes.reserve(1))
    bytes.release(DetectorJournalStorage.BUFFER_BYTES); assertTrue(bytes.reserve(1))
  }
  @Test fun productionAndPacePackagesCannotAccessNoBackupStore() {
    val app = RuntimeEnvironment.getApplication()
    for (name in listOf("app.runjourney.mobile", "app.runjourney.mobile.pace", "app.runjourney.mobile.debug")) {
      val context = object : ContextWrapper(app) { override fun getPackageName() = name }
      assertRejected { DetectorJournalStorage.root(context) }
    }
    val test = object : ContextWrapper(app) { override fun getPackageName() = "app.runjourney.mobile.test" }
    assertEquals(File(test.noBackupFilesDir, "detector-journal-v1"), DetectorJournalStorage.root(test))
  }
  @Test fun encryptedPagesPreserveOrderAndNormalEndNeedsSeal() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret, segmentLimit = 3000)
    for (i in 0..139) journal.append(payload(i, if (i == 139) "END" else "INPUT"), 100L - i, i.toLong())
    val first = JSONObject(DetectorJournalStorage.readJournal(root, id, 0, secret))
    assertEquals(128, first.getJSONArray("records").length()); assertFalse(first.getBoolean("storageComplete"))
    journal.seal()
    val last = JSONObject(DetectorJournalStorage.readJournal(root, id, 128, secret))
    assertEquals(12, last.getJSONArray("records").length()); assertTrue(last.getBoolean("done")); assertTrue(last.getBoolean("storageComplete"))
    assertEquals(128, JSONObject(last.getJSONArray("records").getString(0)).getInt("seq"))
    assertTrue(File(root, id).listFiles()!!.count { it.extension == "enc" } > 1)
    assertFalse(root.walkTopDown().filter { it.isFile }.any { String(it.readBytes()).contains("synthetic-coordinate-placeholder") })
  }
  @Test fun missingEndOrFailureRemainsIncomplete() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret)
    journal.append(payload(0), 0, 0); journal.seal()
    assertFalse(JSONObject(DetectorJournalStorage.readJournal(root, id, 0, secret)).getBoolean("storageComplete"))
    journal.append(payload(1, "END"), 1, 1); journal.failed = true; journal.seal()
    assertFalse(JSONObject(DetectorJournalStorage.readJournal(root, id, 0, secret)).getBoolean("storageComplete"))
  }
  @Test fun deletionTruncationAndCorruptionAreDetected() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret, segmentLimit = 800)
    for (i in 0..5) journal.append(payload(i, if (i == 5) "END" else "INPUT"), 0, 0)
    journal.seal()
    val files = File(root, id).listFiles()!!.filter { it.extension == "enc" }.sortedBy { it.name }
    val first = files.first(); val original = first.readBytes()
    first.writeBytes(original.copyOf(original.size - 1))
    assertRejected { DetectorJournalStorage.readJournal(root, id, 0, secret) }
    first.writeBytes(original)
    files.last().delete()
    // Removing a whole final frame/segment leaves a different authenticated chain tip.
    assertFalse(JSONObject(DetectorJournalStorage.readJournal(root, id, 0, secret)).getBoolean("storageComplete"))
    first.writeBytes(original.apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() })
    assertRejected { DetectorJournalStorage.readJournal(root, id, 0, secret) }
  }
  @Test fun sessionAndTotalLimitsRefuseAndNeverDeleteExistingCapture() = temporary { root ->
    val existing = File(root, "existing.enc").apply { writeBytes(ByteArray(500)) }
    val journal = DetectorJournalStorage.Journal(root, id, secret, sessionLimit = 1200, totalLimit = 1800, compact = false)
    journal.append(payload(0), 0, 0)
    assertRejected { journal.append(payload(1, text = "x".repeat(2000)), 0, 0) }
    assertTrue(existing.exists()); assertTrue(File(root, id).listFiles()!!.any { it.extension == "enc" })
    assertTrue(root.walkTopDown().filter { it.isFile }.sumOf { it.length() } <= 1800)
  }
  @Test fun sequenceGapFailsBeforeAppendAndPathTraversalIsRejected() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret)
    assertRejected { journal.append(payload(1), 0, 0) }
    assertRejected { DetectorJournalStorage.readJournal(root, "../escape", 0, secret) }
  }
  @Test fun totalCapAndOversizedSegmentRefuseWithoutDeletingOldFiles() = temporary { root ->
    val existing = File(root, "existing.enc").apply { writeBytes(ByteArray(500)) }
    val journal = DetectorJournalStorage.Journal(root, id, secret, totalLimit = 600)
    assertRejected { journal.append(payload(0), 0, 0) }
    assertEquals(500, existing.length())
    val small = DetectorJournalStorage.Journal(root, UUID.randomUUID().toString(), secret, segmentLimit = 100)
    assertRejected { small.append(payload(0), 0, 0) }
  }
  @Test fun fileWriteFailureLeavesCaptureUnsealed() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret)
    File(File(root, id), "0000.enc").mkdir() // A directory blocks the output file on all test hosts.
    assertRejected { journal.append(payload(0, "END"), 0, 0) }
    journal.failed = true; journal.seal()
    assertEquals("INCOMPLETE", File(File(root, id), "status").readText())
  }
  @Test fun cursorAuthenticatesEachFrameOnceAndReadsBothEncodings() = temporary { root ->
    for (compact in listOf(false, true)) {
      val journalId = UUID.randomUUID().toString()
      val journal = DetectorJournalStorage.Journal(root, journalId, secret, segmentLimit = 32_000, compact = compact)
      val records = (0..260).map { payload(it, if (it == 260) "END" else "INPUT", "repeated fixture ".repeat(80)) }
      records.forEachIndexed { index, record -> journal.append(record, index.toLong(), index.toLong()) }
      journal.seal()
      val actual = mutableListOf<String>()
      DetectorJournalStorage.Reader(root, journalId, secret).use { reader ->
        repeat(3) { index ->
          val page = reader.next()
          val rows = page.getJSONArray("records")
          for (j in 0 until rows.length()) actual.add(rows.getString(j))
          assertEquals(actual.size, page.getInt("authenticatedRecords"))
          assertEquals(index == 2, page.getBoolean("storageComplete"))
          val legacy = JSONObject(DetectorJournalStorage.readJournal(root, journalId, index * 128, secret))
          assertEquals(legacy.getJSONArray("records").toString(), rows.toString())
        }
      }
      assertEquals(records, actual)
      val size = journal.recordBytes().getJSONObject("INPUT")
      if (compact) assertTrue(size.getLong("storedBytes") < size.getLong("legacyBytes") / 2)
      else assertEquals(size.getLong("legacyBytes"), size.getLong("storedBytes"))
    }
  }

  @Test fun cursorRejectsMissingSegmentBetweenPages() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret, segmentLimit = 700)
    for (i in 0..260) journal.append(payload(i, if (i == 260) "END" else "INPUT"), 0, 0)
    journal.seal()
    DetectorJournalStorage.Reader(root, id, secret).use { reader ->
      assertFalse(reader.next().getBoolean("storageComplete"))
      val last = File(root, id).listFiles()!!.filter { it.extension == "enc" }.maxBy { it.name }
      assertTrue(last.delete())
      assertRejected { while (!reader.next().getBoolean("done")) Unit }
    }
  }

  @Test fun cursorRejectsCiphertextChangedInAnUnreadSegment() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret, segmentLimit = 700)
    for (i in 0..260) journal.append(payload(i, if (i == 260) "END" else "INPUT"), 0, 0)
    journal.seal()
    DetectorJournalStorage.Reader(root, id, secret).use { reader ->
      assertFalse(reader.next().getBoolean("done"))
      val last = File(root, id).listFiles()!!.filter { it.extension == "enc" }.maxBy { it.name }
      val bytes = last.readBytes()
      bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
      last.writeBytes(bytes)
      assertRejected { while (!reader.next().getBoolean("done")) Unit }
    }
  }

  @Test fun cursorRequiresMatchingSealAndRejectsFramesAfterEnd() = temporary { root ->
    val journal = DetectorJournalStorage.Journal(root, id, secret)
    journal.append(payload(0, "END"), 0, 0)
    journal.seal()
    File(File(root, id), "status").writeText("SEALED:wrong-tip")
    DetectorJournalStorage.Reader(root, id, secret).use { reader ->
      val page = reader.next()
      assertTrue(page.getBoolean("done"))
      assertFalse(page.getBoolean("storageComplete"))
    }
    journal.append(payload(1, "INPUT"), 1, 1)
    journal.append(payload(2, "END"), 2, 2)
    journal.seal()
    DetectorJournalStorage.Reader(root, id, secret).use { reader -> assertRejected { reader.next() } }
  }

  @Test fun sevenDayExpiryIsReportedWithoutAutomaticDeletion() {
    val app = RuntimeEnvironment.getApplication()
    val context = object : ContextWrapper(app) { override fun getPackageName() = "app.runjourney.mobile.test" }
    val root = DetectorJournalStorage.root(context)
    val journal = DetectorJournalStorage.Journal(root, id, secret)
    journal.append(payload(0, "END"), 0, 0); journal.seal()
    val dir = File(root, id)
    File(dir, "status").setLastModified(System.currentTimeMillis() - DetectorJournalStorage.RETENTION_MS - 1000)
    val sessions = org.json.JSONArray(DetectorJournalStorage.list(context))
    val session = (0 until sessions.length()).map { sessions.getJSONObject(it) }.single { it.getString("id") == id }
    assertTrue(session.getBoolean("expired")); assertTrue(File(dir, "0000.enc").exists())
    dir.deleteRecursively()
  }
}
