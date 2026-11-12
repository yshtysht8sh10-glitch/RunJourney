package app.runjourney.announcer

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import javax.crypto.spec.SecretKeySpec
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MarkerLogTest {
  @get:Rule val temporary = TemporaryFolder()
  private val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
  private fun fresh() = File(temporary.newFolder(), "markers.jsonl")
  @Test fun providerGeneratesFreshNinetySixBitIvForEachEncryption() {
    val a = fresh(); val b = fresh()
    MarkerLog(a, key).append("START", JSONObject()); MarkerLog(b, key).append("START", JSONObject())
    val av = JSONObject(a.readText()).getString("iv"); val bv = JSONObject(b.readText()).getString("iv")
    assertEquals(12, android.util.Base64.decode(av, android.util.Base64.NO_WRAP).size)
    assertNotEquals(av, bv)
    assertFalse(MarkerLog.read(a, key).getBoolean("complete"))
  }
  @Test fun authenticatedSequenceRoundTripsAndCloses() {
    val file = fresh(); val log = MarkerLog(file, key)
    log.append("START", JSONObject().put("simulation", true))
    log.append("MARKER", JSONObject().put("label", "STOP").put("wall", 123))
    log.append("END", JSONObject().put("complete", true))
    val read = MarkerLog.read(file, key)
    assertTrue(read.getBoolean("complete")); assertEquals(3, read.getJSONArray("records").length())
    assertFalse(file.readText().contains("STOP"))
    assertThrows(IllegalStateException::class.java) { log.append("MARKER", JSONObject()) }
  }
  @Test fun processDeathDoesNotCreateCompleteSession() {
    val file = fresh(); MarkerLog(file, key).append("START", JSONObject())
    assertFalse(MarkerLog.read(file, key).getBoolean("complete"))
    assertThrows(IllegalStateException::class.java) { MarkerLog(file, key) }
  }
  @Test fun lostRecordAndTamperingFailClosed() {
    val file = fresh(); val log = MarkerLog(file, key)
    log.append("START", JSONObject()); log.append("MARKER", JSONObject()); log.append("END", JSONObject().put("complete", true))
    val lines = file.readLines(); file.writeText(lines[0] + "\n" + lines[2] + "\n")
    assertThrows(Exception::class.java) { MarkerLog.read(file, key) }
    val envelope = JSONObject(lines[0]); val encrypted = envelope.getString("cipher")
    envelope.put("cipher", (if (encrypted[0] == 'A') "B" else "A") + encrypted.substring(1))
    file.writeText(envelope.toString() + "\n")
    assertThrows(Exception::class.java) { MarkerLog.read(file, key) }
  }
  @Test fun routeLossIsStorageCompleteButNotACompleteFieldTrial() {
    val file = fresh(); val log = MarkerLog(file, key)
    log.append("START", JSONObject()); log.append("END", JSONObject().put("complete", false).put("reason", "HEADSET_ROUTE_REMOVED"))
    val result = MarkerLog.read(file, key)
    assertTrue(result.getBoolean("storageComplete")); assertFalse(result.getBoolean("complete"))
  }
  @Test fun capacityDoesNotDeleteExistingFiles() {
    val file = fresh(); val log = MarkerLog(file, key)
    log.append("START", JSONObject()); val before = file.readBytes()
    val filler = File(file.parentFile, "existing.data").apply { writeBytes(ByteArray(10_000_000)) }
    assertThrows(IllegalStateException::class.java) { log.append("MARKER", JSONObject()) }
    assertArrayEquals(before, file.readBytes()); assertEquals(10_000_000, filler.length().toInt())
  }
}
