package app.runjourney.announcer

import android.content.Context
import android.system.Os
import android.system.OsConstants
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID

/** Durable cross-runtime ownership. No coordinates, history, settings or audio are stored here.
 * A lease never expires by time: uncertain writes block the next START until reconciled.
 * This port does not start GPS or decide whether legacy drafts can be adopted.
 */
class MeasurementOwnership(private val context: Context, private val ioCheck: (String) -> Unit = {},
  private val atomicReplace: (File, File) -> Unit = { source, target -> Os.rename(source.absolutePath, target.absolutePath) },
  private val directorySync: (File) -> Unit = { folder ->
    check(folder.isDirectory) { "OWNERSHIP_DIRECTORY" }
    val descriptor = Os.open(folder.absolutePath, OsConstants.O_RDONLY, 0)
    try { Os.fsync(descriptor) } finally { Os.close(descriptor) }
  },
  private val allowWrite: () -> Boolean = { true }) {
  private val directory = File(context.noBackupFilesDir, "measurement-ownership-v1")
  private val stateFile get() = File(directory, "owner.json")

  companion object { private val monitor = Any(); private val ensuredDirectories = mutableSetOf<String>() }

  private fun fresh() = JSONObject().put("version", 1).put("generation", 0L)
    .put("binding", JSONObject.NULL).put("leases", JSONObject())

  private fun integer(value: Any): Long {
    check(value is Number) { "OWNERSHIP_INTEGER" }
    val number = value.toDouble()
    check(number.isFinite() && number >= 0 && number <= 9007199254740991.0 && number == value.toLong().toDouble()) { "OWNERSHIP_INTEGER" }
    return value.toLong()
  }

  private fun validateBinding(b: JSONObject) {
    check(listOf("purpose", "databaseKey", "sessionId", "status").all { b.get(it) is String }) { "OWNERSHIP_STRING" }
    val purpose = b.getString("purpose")
    val expected = when (purpose) { "running" -> "runjourney.sqlite"; "cycling" -> "runjourney-cycling.sqlite"; "generic" -> "none"; else -> error("OWNERSHIP_PURPOSE") }
    check(b.getString("databaseKey") == expected) { "OWNERSHIP_DESTINATION" }
    check(integer(b.get("profileVersion")) == 1L) { "OWNERSHIP_PROFILE" }
    check(b.getString("sessionId").matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "OWNERSHIP_ID" }
    check(b.get("startedAt") is Number && b.getDouble("startedAt").isFinite() && b.getDouble("startedAt") >= 0) { "OWNERSHIP_CLOCK" }
    check(b.getString("status") in listOf("STARTING", "ACTIVE", "STOPPING", "FINISH_FAILED")) { "OWNERSHIP_STATUS" }
    check(integer(b.get("generation")) > 0) { "OWNERSHIP_GENERATION" }
  }

  private fun load(): JSONObject {
    val file = stateFile
    // Never recover/overwrite an ambiguous backup from an unknown writer.
    check(!File(file.path + ".bak").exists()) { "OWNERSHIP_RECOVERY_REQUIRED" }
    if (!file.exists()) return fresh()
    val text = file.inputStream().use { input ->
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
    check(state.has("binding") && integer(state.get("version")) == 1L && integer(state.get("generation")) >= 0) { "OWNERSHIP_VERSION" }
    val leases = state.getJSONObject("leases")
    check(leases.length() <= 128) { "OWNERSHIP_LEASE_LIMIT" }
    if (!state.isNull("binding")) {
      val binding = state.getJSONObject("binding"); validateBinding(binding)
      check(binding.getLong("generation") == state.getLong("generation")) { "OWNERSHIP_GENERATION" }
      leases.keys().forEach { token -> check(integer(leases.get(token)) == state.getLong("generation")) { "OWNERSHIP_LEASE" } }
    } else check(leases.length() == 0) { "OWNERSHIP_ORPHAN_LEASE" }
    return state
  }

  private fun save(state: JSONObject, file: File = stateFile) {
    check(allowWrite()) { "OWNERSHIP_WRITE_FAILED" }
    val bytes = state.toString().toByteArray(Charsets.UTF_8)
    check(bytes.size <= 32768) { "OWNERSHIP_SIZE" }
    // AtomicFile.finishWrite silently logs some sync/rename failures. A safety
    // ownership ACK instead uses checked syscalls: file sync -> rename -> dir sync.
    val pending = File(file.path + ".new")
    pending.outputStream().use { output ->
      output.write(bytes); ioCheck("FILE_SYNC"); output.fd.sync()
    }
    ioCheck("RENAME"); atomicReplace(pending, file)
    syncDirectory(directory)
    check(file.readBytes().contentEquals(bytes)) { "OWNERSHIP_READBACK" }
  }

  private fun syncDirectory(folder: File) {
    ioCheck("DIRECTORY_SYNC")
    directorySync(folder)
  }

  private fun readJson(file: File): JSONObject {
    check(file.length() <= 4096 && !File(file.path + ".bak").exists()) { "OWNERSHIP_SETTINGS_CORRUPT" }
    return JSONObject(file.readText(Charsets.UTF_8))
  }

  private fun validateTop(value: JSONObject) {
    check(integer(value.get("version")) == 1L && listOf("assistantEnabled", "genericTimeEnabled", "onboardingSeen").all { value.get(it) is Boolean }) { "OWNERSHIP_SETTINGS_CORRUPT" }
    check(value.length() == 4) { "OWNERSHIP_SETTINGS_CORRUPT" }
  }

  private fun topSettings(): JSONObject {
    val settings = File(directory, "top-settings.json")
    check(!File(settings.path + ".bak").exists()) { "OWNERSHIP_SETTINGS_CORRUPT" }
    if(settings.exists()) return readJson(settings).also { validateTop(it) }
    val bootstrap = File(directory, "installation-evidence.json")
    check(!File(bootstrap.path + ".bak").exists()) { "OWNERSHIP_SETTINGS_CORRUPT" }
    val evidence = if(bootstrap.exists()) readJson(bootstrap) else {
      // Must be called before the ordinary storage gate can initialize any DB.
      val sqlite = File(context.filesDir, "SQLite")
      JSONObject().put("version", 1).put("existingInstallation", listOf(
        File(sqlite, "runjourney.sqlite"), File(sqlite, "runjourney-cycling.sqlite"), context.getDatabasePath("RKStorage")
      ).any { it.exists() }).also { save(it, bootstrap) }
    }
    check(integer(evidence.get("version")) == 1L && evidence.get("existingInstallation") is Boolean) { "OWNERSHIP_SETTINGS_CORRUPT" }
    val initial = JSONObject().put("version", 1).put("assistantEnabled", evidence.getBoolean("existingInstallation"))
      .put("genericTimeEnabled", false).put("onboardingSeen", false)
    save(initial, settings); return initial
  }

  fun command(action: String, payload: String = "{}"): String = synchronized(monitor) {
    check(payload.length <= 4096) { "OWNERSHIP_SIZE" }
    val created = !directory.isDirectory
    check(!created || directory.mkdirs()) { "OWNERSHIP_DIRECTORY" }
    // Persist the directory once per process, and retry after a failed creation ACK.
    if (created || directory.absolutePath !in ensuredDirectories) {
      syncDirectory(requireNotNull(directory.parentFile)); ensuredDirectories.add(directory.absolutePath)
    }
    RandomAccessFile(File(directory, "owner.lock"), "rw").use { lockFile ->
      lockFile.channel.lock().use {
        val state = load(); val request = JSONObject(payload)
        if (action == "topRead") return@synchronized topSettings().toString()
        if (action == "topSave") {
          check(state.isNull("binding")) { "OWNERSHIP_BUSY" }
          // A corrupt/unknown existing settings file must not be silently reset.
          topSettings(); validateTop(request)
          save(request, File(directory, "top-settings.json")); return@synchronized request.toString()
        }
        if (action == "read") return@synchronized state.toString()
        var binding = if (state.isNull("binding")) null else state.getJSONObject("binding")
        val leases = state.getJSONObject("leases")
        if (action == "claim") {
          check(binding == null) { "OWNERSHIP_BUSY" }
          check(state.getLong("generation") < 9007199254740991L) { "OWNERSHIP_GENERATION" }
          check(listOf("sessionId", "purpose", "databaseKey").all { request.get(it) is String }
            && request.get("startedAt") is Number && integer(request.get("profileVersion")) == 1L) { "OWNERSHIP_REQUEST" }
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
        check(request.get("sessionId") is String && current.getString("sessionId") == request.getString("sessionId") && current.getLong("generation") == integer(request.get("generation"))) { "OWNERSHIP_STALE" }
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
