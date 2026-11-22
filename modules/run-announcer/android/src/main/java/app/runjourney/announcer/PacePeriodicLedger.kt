package app.runjourney.announcer

import android.content.Context
import android.util.AtomicFile
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** Speech-only durable receipt ledger. Never reads/writes RUN or GPS storage. */
internal class PacePeriodicLedger(context: Context, private val writeOverride: ((String) -> Boolean)? = null) {
  companion object { private val ioLock=Any() }
  private val file = AtomicFile(File(context.filesDir,"pace-periodic-v1.json"))
  private val legacyPrefs=context.getSharedPreferences("runjourney-pace-periodic-v1",0)
  private fun load() = synchronized(ioLock) {
    try { JSONObject(file.openRead().bufferedReader().use { it.readText() }) }
    catch (_: java.io.FileNotFoundException) { JSONObject(legacyPrefs.getString("ledger","{}") ?: "{}") }
  }
  private fun save(value: JSONObject): Boolean = synchronized(ioLock) {
    writeOverride?.let { return it(value.toString()) }
    var stream:java.io.FileOutputStream?=null
    try {
      val bytes=value.toString().toByteArray(Charsets.UTF_8)
      stream=file.startWrite();stream.write(bytes);stream.fd.sync();file.finishWrite(stream)
      file.openRead().use { it.readBytes().contentEquals(bytes) }
    } catch (_: Exception) { file.failWrite(stream);false }
  }
  @Synchronized fun state(run: String, config: String): String {
    val s = load()
    return if (s.optString("runId") == run && s.optString("configKey") == config)
      JSONObject().put("acceptedThrough", s.optLong("acceptedThrough")).put("activeFromMs", s.optLong("activeFromMs"))
        .put("unknownCompletionCount",s.optLong("unknownCompletionCount")).toString() else "null"
  }
  @Synchronized fun configure(schedule: JSONObject, now: Long): Boolean {
    if (schedule.optInt("version") != 1 || schedule.optLong("intervalMs") !in 60000L..600000L || schedule.optString("runId").isBlank()) return false
    val old = load()
    val same = old.optString("runId") == schedule.optString("runId") && old.optString("configKey") == schedule.optString("configKey")
    val enabled = schedule.optBoolean("enabled")
    if (same && old.optBoolean("enabled") == enabled) return true
    val started = schedule.optLong("startedAt")
    val firstInterval = now - started < schedule.optLong("intervalMs")
    val s = if (same) old else JSONObject().put("runId", schedule.optString("runId")).put("configKey", schedule.optString("configKey"))
      .put("unknownCompletionCount",if(old.optString("runId")==schedule.optString("runId"))old.optLong("unknownCompletionCount") else 0)
      .put("acceptedThrough", if (old.optString("runId") != schedule.optString("runId") && firstInterval) 0 else ((now-started)/schedule.optLong("intervalMs")).coerceAtLeast(0))
      .put("activeFromMs", if (old.optString("runId") != schedule.optString("runId") && firstInterval) started else now)
    if (!same || !enabled || !old.optBoolean("enabled")) {
      s.put("pending", JSONArray()).put("cancelReason", if (!enabled) "SETTING_OFF" else "CONFIG_CHANGED")
      if (same && enabled) s.put("activeFromMs", now)
    }
    return save(s.put("enabled", enabled).put("ended", false))
  }
  @Synchronized fun accept(notice: JSONObject): String {
    val s = load(); val p = notice.optJSONObject("data")?.optJSONObject("pacePeriodicSnapshot") ?: return "INVALID_SNAPSHOT"
    if (p.optInt("version") != 1 || p.optString("runId") != s.optString("runId") || p.optString("configKey") != s.optString("configKey") || !s.optBoolean("enabled") || s.optBoolean("ended")) return "INACTIVE_SCHEDULE"
    val slot = p.optLong("slot")
    if (slot <= s.optLong("acceptedThrough")) return "ALREADY_ACCEPTED"
    if (slot != s.optLong("acceptedThrough") + 1) return "NONCONTIGUOUS_SLOT"
    val quality = p.optString("quality")
    if (quality !in listOf("READY", "DATA_INSUFFICIENT", "CANCELLED_NO_RUNNING", "CONFIG_CHANGED")) return "INVALID_QUALITY"
    val pending = s.optJSONArray("pending") ?: JSONArray()
    val silent = quality in listOf("CANCELLED_NO_RUNNING", "CONFIG_CHANGED")
    if (!silent && pending.length() >= 32) return "BACKPRESSURE"
    if (!silent) pending.put(JSONObject(notice.toString()).put("expiresAt", Long.MAX_VALUE))
    s.put("pending", pending).put("acceptedThrough", slot)
    return if (!save(s)) "PERSIST_FAILED" else if (silent) "TERMINAL_CANCEL_ACK" else "PERSISTED_ACK"
  }
  @Synchronized fun pending(run: String): List<JSONObject> {
    val s=load(); if(s.optString("runId") != run || !s.optBoolean("enabled") || s.optBoolean("ended")) return emptyList()
    val a=s.optJSONArray("pending") ?: JSONArray()
    return (0 until a.length()).map { JSONObject(a.getJSONObject(it).toString()) }
  }
  @Synchronized fun complete(id: String): Boolean {
    val s=load(); val a=s.optJSONArray("pending") ?: return true
    s.put("pending", JSONArray((0 until a.length()).map { a.getJSONObject(it) }.filter { it.optString("id") != id }))
    return save(s)
  }
  /** Written immediately before requesting body output; not proof that audio was heard. */
  @Synchronized fun bodyRequested(id:String,at:Long):Boolean {
    val s=load();val a=s.optJSONArray("pending") ?: return true
    val n=(0 until a.length()).map{a.getJSONObject(it)}.firstOrNull{it.optString("id")==id} ?: return true
    if(n.optString("attemptState")=="BODY_REQUESTED")return true
    n.put("attemptState","BODY_REQUESTED").put("bodyRequestedAt",at)
    return save(s)
  }
  /** A new service cannot know whether an interrupted process completed speech. */
  @Synchronized fun recoverUnknown():List<JSONObject>? {
    val s=load();val a=s.optJSONArray("pending") ?: return emptyList()
    val unknown=(0 until a.length()).map{a.getJSONObject(it)}.filter{it.optString("attemptState")=="BODY_REQUESTED"}
    if(unknown.isEmpty())return emptyList()
    s.put("pending",JSONArray((0 until a.length()).map{a.getJSONObject(it)}.filter{it.optString("attemptState")!="BODY_REQUESTED"}))
      .put("unknownCompletionCount",s.optLong("unknownCompletionCount")+unknown.size)
      .put("lastUnknownCompletionIds",JSONArray(unknown.take(32).map{it.optString("id")}))
    return if(save(s)) unknown else null
  }
  @Synchronized fun end(run: String): Boolean {
    val s=load(); if(s.optString("runId") != run) return true
    return save(s.put("ended", true).put("pending", JSONArray()).put("cancelReason", "RUN_ENDED"))
  }
}
