package app.runjourney.announcer

import android.content.Context
import android.util.Log
import expo.modules.kotlin.Promise
import org.json.JSONArray
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal object VoiceLogStorage {
  private val worker = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(128)) { r ->
    Thread(r, "RunJourneyVoiceLog").apply { isDaemon = true }
  }
  private var journal: VoiceLogJournal? = null
  private fun store(context: Context): VoiceLogJournal {
    journal?.let { return it }
    val target = File(context.filesDir, "voice-log-v2")
    VoiceLogJournal.migrateLegacy(target, {
      val old = JSONArray(context.getSharedPreferences("runjourney-voice-debug", 0).getString("entries", "[]"))
      (0 until old.length()).map { i -> val e = old.getJSONObject(i); e.optLong("loggedAt") to e.toString() }
    }, System.currentTimeMillis())
    // Original preferences remain recoverable; completed directory prevents duplicate migration.
    return VoiceLogJournal(target).also { journal = it }
  }
  fun append(context: Context, payload: String, timestamp: Long) {
    try { worker.execute {
      try { store(context.applicationContext).append(payload, timestamp) }
      catch (e: Exception) { journal = null; Log.w("RunAnnouncer", "Voice journal append failed", e) }
    } } catch (e: Exception) { Log.w("RunAnnouncer", "Voice journal backlog full", e) }
  }
  fun read(context: Context, limit: Int, promise: Promise) {
    try { worker.execute {
      try { promise.resolve(store(context.applicationContext).read(limit, System.currentTimeMillis())) }
      catch (e: Exception) { promise.reject("VOICE_LOG_READ", e.message, e) }
    } } catch (e: Exception) { promise.reject("VOICE_LOG_BUSY", e.message, e) }
  }
}
