package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.json.JSONObject
import java.io.*
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SensorJournalTest {
  @get:Rule val temporary = TemporaryFolder()
  private val key = SecretKeySpec(ByteArray(32) { 11 }, "AES")
  private fun file() = File(temporary.newFolder(), "synthetic.sdiag")
  private fun samples(type: Int, count: Int): ByteArray {
    val out = ByteArrayOutputStream()
    DataOutputStream(out).use { b -> b.writeInt(type); b.writeInt(count); repeat(count) { i ->
      b.writeLong(i * 40_000_000L); b.writeLong(i * 40_000_000L + 2_000_000)
      b.writeFloat(.1f); b.writeFloat(9.81f); b.writeFloat(.2f); b.writeInt(3)
    } }
    return out.toByteArray()
  }
  @Test fun authenticatesAndDetectsInterruptedTamperedAndOverwrittenFiles() {
    val f = file(); val log = SensorJournal(f, key)
    log.json("START", JSONObject().put("synthetic", true)); log.append("SAMPLES", samples(1, 25)); log.sync()
    assertFalse(SensorJournal.verify(f, key).getBoolean("storageComplete"))
    assertThrows(IllegalStateException::class.java) { SensorJournal(f, key) }
    log.json("END", JSONObject().put("complete", true).put("sampleCount", 25)); log.close()
    val verified = SensorJournal.verify(f, key)
    assertTrue(verified.getBoolean("complete")); assertEquals(25, verified.getInt("samples"))
    val bytes = f.readBytes(); bytes[bytes.size / 2] = (bytes[bytes.size / 2].toInt() xor 1).toByte(); f.writeBytes(bytes)
    assertThrows(Exception::class.java) { SensorJournal.verify(f, key) }
  }
  @Test fun missingFrameAndWrongSampleCountAreRejected() {
    val f = file(); val log = SensorJournal(f, key)
    log.json("START", JSONObject()); log.append("SAMPLES", samples(4, 25))
    log.json("END", JSONObject().put("complete", true).put("sampleCount", 24)); log.close()
    assertThrows(IllegalStateException::class.java) { SensorJournal.verify(f, key) }
    val bytes = f.readBytes(); val size = DataInputStream(ByteArrayInputStream(bytes)).readInt() + 16
    f.writeBytes(bytes.copyOfRange(size, bytes.size))
    assertThrows(Exception::class.java) { SensorJournal.verify(f, key) }
  }
  @Test fun capacityLeavesSpaceForIncompleteEndWithoutDeletingAnotherFile() {
    val f = file(); val keep = File(f.parentFile, "keep").apply { writeText("unchanged") }
    val log = SensorJournal(f, key, 5000, 10000); log.json("START", JSONObject())
    assertThrows(IllegalStateException::class.java) { log.append("SAMPLES", samples(1, 100)) }
    log.json("END", JSONObject().put("complete", false).put("sampleCount", 0)); log.close()
    assertFalse(SensorJournal.verify(f, key).getBoolean("complete")); assertEquals("unchanged", keep.readText())
  }
  @Test fun ninetyFiveMinutesAtTwentyFiveHzBothSensorsFitsAndAuthenticates() {
    val f = file(); val log = SensorJournal(f, key)
    log.json("START", JSONObject().put("synthetic", true))
    repeat(2850) {
      log.append("SAMPLES", samples(1, 50)); log.append("SAMPLES", samples(4, 50))
      repeat(2) { log.json("GPS", JSONObject().put("synthetic", true).put("padding", "x".repeat(300))) }
      log.json("HEALTH", JSONObject().put("padding", "x".repeat(900)))
    }
    log.json("END", JSONObject().put("complete", true).put("sampleCount", 285000)); log.close()
    assertTrue(f.length() < 16L * 1024 * 1024)
    val read = SensorJournal.verify(f, key)
    assertTrue(read.getBoolean("complete")); assertEquals(285000, read.getInt("samples")); assertEquals(5700, read.getInt("gpsLinks"))
  }
}
