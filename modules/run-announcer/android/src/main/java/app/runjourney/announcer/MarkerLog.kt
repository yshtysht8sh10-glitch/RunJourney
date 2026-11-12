package app.runjourney.announcer

import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import android.util.Base64

/** Independent marker sidecar. Never opens RUN SQLite, detector journals or voice logs. */
internal class MarkerLog(private val file: File, private val key: SecretKey) {
  private var sequence = 0
  private var previous = ""
  private var ended = false
  private val random = SecureRandom()
  init { check(!file.exists()) { "No overwrite" }; check(file.parentFile!!.isDirectory || file.parentFile!!.mkdirs()) }
  fun append(kind: String, data: JSONObject) {
    check(!ended && sequence < 4096 && file.length() < 2_000_000) { "Marker capacity or closed" }
    val plain = JSONObject().put("seq", sequence).put("previous", previous).put("kind", kind).put("data", data).toString().toByteArray(Charsets.UTF_8)
    val iv = ByteArray(12).also { random.nextBytes(it) }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv)) }
    val payload = JSONObject().put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
      .put("cipher", Base64.encodeToString(cipher.doFinal(plain), Base64.NO_WRAP)).toString() + "\n"
    check(file.length() + payload.toByteArray(Charsets.UTF_8).size <= 2_000_000)
    check((file.parentFile!!.listFiles()?.sumOf { it.length() } ?: 0) + payload.toByteArray(Charsets.UTF_8).size <= 10_000_000)
    FileOutputStream(file, true).use { it.write(payload.toByteArray(Charsets.UTF_8)); it.fd.sync() }
    previous = digest(plain); sequence++; ended = kind == "END"
  }
  companion object {
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun read(file: File, key: SecretKey): JSONObject {
      check(file.length() <= 2_100_000) { "Marker size" }
      val records = org.json.JSONArray(); var previous = ""; var ended = false
      file.bufferedReader().useLines { lines -> lines.forEach { line ->
        check(!ended && records.length() < 4096)
        val envelope = JSONObject(line)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key,
          GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP))) }
        val bytes = cipher.doFinal(Base64.decode(envelope.getString("cipher"), Base64.NO_WRAP))
        val record = JSONObject(String(bytes, Charsets.UTF_8))
        check(record.getInt("seq") == records.length() && record.getString("previous") == previous)
        check(records.length() > 0 || record.getString("kind") == "START")
        previous = digest(bytes); ended = record.getString("kind") == "END"; records.put(record)
      } }
      val complete = ended && records.getJSONObject(records.length() - 1).getJSONObject("data").optBoolean("complete")
      return JSONObject().put("schema", 1).put("storageComplete", ended).put("complete", complete).put("records", records)
    }
  }
}
