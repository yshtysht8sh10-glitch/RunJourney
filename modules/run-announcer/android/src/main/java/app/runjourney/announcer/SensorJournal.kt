package app.runjourney.announcer

import java.io.*
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** Separate append-only authenticated store. No SQLite, retention or detector dependencies. */
internal class SensorJournal(val file: File, private val key: SecretKey,
  private val sessionLimit: Long = 16L * 1024 * 1024,
  private val totalLimit: Long = 64L * 1024 * 1024) : Closeable {
  private var sequence = 0
  private var previous = ByteArray(32)
  private var ended = false
  private val stream: FileOutputStream
  private val out: DataOutputStream
  init {
    check(!file.exists()) { "NO_OVERWRITE" }
    check(file.parentFile!!.isDirectory || file.parentFile!!.mkdirs())
    check(file.createNewFile()) { "NO_OVERWRITE" }
    stream = FileOutputStream(file, true); out = DataOutputStream(stream)
  }
  fun append(kind: String, payload: ByteArray) {
    check(!ended && payload.size <= 65536) { "CLOSED_OR_FRAME_LIMIT" }
    val buffer = ByteArrayOutputStream()
    DataOutputStream(buffer).use { it.writeInt(sequence); it.write(previous); it.writeUTF(kind); it.writeInt(payload.size); it.write(payload) }
    val plain = buffer.toByteArray()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
    check(cipher.iv.size == 12)
    val encrypted = cipher.doFinal(plain)
    val size = 4L + 12 + encrypted.size
    val total = file.parentFile!!.listFiles()?.sumOf { it.length() } ?: 0
    // Keep space for END even if the data budget is exhausted.
    val reserve = if (kind == "END") 0 else 4096
    check(file.length() + size + reserve <= sessionLimit && total + size + reserve <= totalLimit) { "CAPACITY" }
    out.writeInt(encrypted.size); out.write(cipher.iv); out.write(encrypted)
    previous = hash(plain); sequence++; ended = kind == "END"
  }
  fun json(kind: String, data: JSONObject) = append(kind, data.toString().toByteArray(Charsets.UTF_8))
  fun sync() { out.flush(); stream.fd.sync() }
  override fun close() { out.flush(); stream.fd.sync(); out.close() }
  companion object {
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
    /** Stream verification: retain metadata/events, never load the sample stream in RAM. */
    fun verify(file: File, key: SecretKey): JSONObject {
      var seq = 0; var previous = ByteArray(32); var ended = false
      var samples = 0L; var gps = 0; var labels = 0; var healthFrames = 0
      val events = org.json.JSONArray()
      DataInputStream(BufferedInputStream(FileInputStream(file))).use { input ->
        while (input.available() > 0) {
          check(!ended)
          val size = input.readInt(); check(size in 16..66000)
          val iv = ByteArray(12); input.readFully(iv)
          val bytes = ByteArray(size); input.readFully(bytes)
          val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv)) }
          val plain = cipher.doFinal(bytes)
          DataInputStream(ByteArrayInputStream(plain)).use { record ->
            check(record.readInt() == seq)
            val chain = ByteArray(32); record.readFully(chain); check(chain.contentEquals(previous))
            val kind = record.readUTF(); val length = record.readInt(); check(length in 0..65536)
            val payload = ByteArray(length); record.readFully(payload); check(record.available() == 0)
            check(seq > 0 || kind == "START")
            if (kind == "SAMPLES") {
              DataInputStream(ByteArrayInputStream(payload)).use { block ->
                check(block.readInt() in listOf(1, 4)); val count = block.readInt(); check(count in 1..2048)
                check(block.available() == count * 32); samples += count
              }
            } else {
              val data = JSONObject(String(payload, Charsets.UTF_8))
              if (kind == "GPS") gps++
              if (kind == "LABEL") labels++
              if (kind == "HEALTH") healthFrames++
              if (kind !in listOf("GPS", "HEALTH")) events.put(JSONObject().put("kind", kind).put("data", data))
              if (kind == "END") check(data.getLong("sampleCount") == samples) { "SAMPLE_COUNT" }
              ended = kind == "END"
            }
          }
          previous = hash(plain); seq++
        }
      }
      val complete = ended && events.getJSONObject(events.length() - 1).getJSONObject("data").optBoolean("complete")
      return JSONObject().put("schema", 1).put("authenticatedFrames", seq).put("samples", samples)
        .put("gpsLinks", gps).put("labels", labels).put("healthFrames", healthFrames).put("storageComplete", ended).put("complete", complete).put("events", events)
    }
  }
}
