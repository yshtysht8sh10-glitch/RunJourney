package app.runjourney.announcer

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID

/** Durable cross-runtime ownership. No coordinates, history, settings or audio are stored here.
 * A lease never expires by time: uncertain writes block the next START until reconciled.
 * This port does not start GPS or decide whether legacy drafts can be adopted.
 */
class MeasurementOwnership(context: Context, private val allowWrite: () -> Boolean = { true }) {
  private val directory = File(context.noBackupFilesDir, "measurement-ownership-v1")
  private val stateFile get() = AtomicFile(File(directory, "owner.json"))

  companion object { private val monitor = Any() }

  private fun fresh() = JSONObject().put("version", 1).put("generation", 0L)
    .put("binding", JSONObject.NULL).put("leases", JSONObject())

  private fun validateBinding(b: JSONObject) {
    val purpose = b.getString("purpose")
    val expected = when (purpose) { "running" -> "runjourney.sqlite"; "cycling" -> "runjourney-cycling.sqlite"; "generic" -> "none"; else -> error("OWNERSHIP_PURPOSE") }
    check(b.getString("databaseKey") == expected) { "OWNERSHIP_DESTINATION" }
    check(b.getInt("profileVersion") == 1) { "OWNERSHIP_PROFILE" }
    check(b.getString("sessionId").matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "OWNERSHIP_ID" }
    check(b.getDouble("startedAt").isFinite() && b.getDouble("startedAt") >= 0) { "OWNERSHIP_CLOCK" }
    check(b.getString("status") in listOf("STARTING", "ACTIVE", "STOPPING", "FINISH_FAILED")) { "OWNERSHIP_STATUS" }
    check(b.getLong("generation") > 0) { "OWNERSHIP_GENERATION" }
  }

  private fun load(): JSONObject {
    val file = stateFile
    if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return fresh()
    val text = file.openRead().use { input ->
      val output = java.io.ByteArrayOutputStream()
      val buffer = ByteArray(4096)
      while (true) {
        val count = input.read(buffer); if (count < 0) break
        check(output.size() + count <= 32768) { "OWNERSHIP_SIZE" }
        output.write(buffer, 0, count)
      }
      output.toString("UTF-8")
    }
    val state = JSONObject(text)
    check(state.has("binding") && state.getInt("version") == 1 && state.getLong("generation") >= 0) { "OWNERSHIP_VERSION" }
    val leases = state.getJSONObject("leases")
    check(leases.length() <= 128) { "OWNERSHIP_LEASE_LIMIT" }
    if (!state.isNull("binding")) {
      val binding = state.getJSONObject("binding"); validateBinding(binding)
      check(binding.getLong("generation") == state.getLong("generation")) { "OWNERSHIP_GENERATION" }
      leases.keys().forEach { token -> check(leases.getLong(token) == state.getLong("generation")) { "OWNERSHIP_LEASE" } }
    } else check(leases.length() == 0) { "OWNERSHIP_ORPHAN_LEASE" }
    return state
  }

  private fun save(state: JSONObject) {
    check(allowWrite()) { "OWNERSHIP_WRITE_FAILED" }
    val bytes = state.toString().toByteArray(Charsets.UTF_8)
    check(bytes.size <= 32768) { "OWNERSHIP_SIZE" }
    val file = stateFile; val output = file.startWrite()
    try { output.write(bytes); file.finishWrite(output) }
    catch (error: Throwable) { file.failWrite(output); throw error }
  }

  fun command(action: String, payload: String = "{}"): String = synchronized(monitor) {
    check(payload.length <= 4096) { "OWNERSHIP_SIZE" }
    check(directory.isDirectory || directory.mkdirs()) { "OWNERSHIP_DIRECTORY" }
    RandomAccessFile(File(directory, "owner.lock"), "rw").use { lockFile ->
      lockFile.channel.lock().use {
        val state = load(); val request = JSONObject(payload)
        if (action == "read") return@synchronized state.toString()
        var binding = if (state.isNull("binding")) null else state.getJSONObject("binding")
        val leases = state.getJSONObject("leases")
        if (action == "claim") {
          check(binding == null) { "OWNERSHIP_BUSY" }
          check(state.getLong("generation") < Long.MAX_VALUE) { "OWNERSHIP_GENERATION" }
          val next = state.getLong("generation") + 1
          binding = JSONObject().put("sessionId", request.getString("sessionId"))
            .put("purpose", request.getString("purpose")).put("databaseKey", request.getString("databaseKey"))
            .put("profileVersion", request.getInt("profileVersion")).put("startedAt", request.getDouble("startedAt"))
            .put("status", "STARTING").put("generation", next)
          validateBinding(binding)
          state.put("binding", binding).put("generation", next); save(state)
          return@synchronized state.toString()
        }
        val current = checkNotNull(binding) { "OWNERSHIP_IDLE" }
        check(current.getString("sessionId") == request.getString("sessionId") && current.getLong("generation") == request.getLong("generation")) { "OWNERSHIP_STALE" }
        when (action) {
          "activate" -> {
            check(current.getString("status") == "STARTING") { "OWNERSHIP_STATUS" }
            current.put("status", "ACTIVE")
          }
          "lease" -> {
            check(current.getString("status") == "ACTIVE") { "OWNERSHIP_NOT_ACTIVE" }
            check(leases.length() < 128) { "OWNERSHIP_LEASE_LIMIT" }
            val token = UUID.randomUUID().toString()
            leases.put(token, current.getLong("generation")); save(state)
            return@synchronized JSONObject().put("token", token).put("binding", current).toString()
          }
          "release" -> {
            val token = request.getString("token")
            check(leases.has(token) && leases.getLong(token) == current.getLong("generation")) { "OWNERSHIP_LEASE" }
            leases.remove(token)
          }
          "stop" -> {
            check(current.getString("status") in listOf("STARTING", "ACTIVE", "STOPPING", "FINISH_FAILED")) { "OWNERSHIP_STATUS" }
            current.put("status", "STOPPING")
          }
          "failed" -> {
            check(current.getString("status") == "STOPPING") { "OWNERSHIP_STATUS" }
            current.put("status", "FINISH_FAILED")
          }
          "finish" -> {
            check(current.getString("status") == "STOPPING" && leases.length() == 0) { "OWNERSHIP_NOT_DRAINED" }
            // Caller must first confirm GPS stopped and its fixed sink's final durable ACK.
            state.put("binding", JSONObject.NULL)
          }
          else -> error("OWNERSHIP_ACTION")
        }
        save(state); state.toString()
      }
    }
  }
}
