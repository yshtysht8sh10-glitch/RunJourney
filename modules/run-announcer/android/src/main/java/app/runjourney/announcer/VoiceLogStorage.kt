package app.runjourney.announcer

import android.content.Context
import android.util.Log
import expo.modules.kotlin.Promise
import org.json.JSONArray
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

internal object VoiceLogStorage {
  private val worker = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(128)) { r ->
    Thread(r, "RunJourneyVoiceLog").apply { isDaemon = true }
  }
  private var journal: VoiceLogJournal? = null
  private var compact:CompactVoiceTrace?=null
  private val losses=ConcurrentHashMap<String,AtomicLong>()
  private val unattributedLoss=AtomicLong()
  private fun compact(context:Context):CompactVoiceTrace {
    compact?.let{return it}
    return CompactVoiceTrace(File(context.filesDir,"voice-compact-v1")).also{compact=it}
  }
  private fun flushLosses(context:Context) {
    if(context.packageName!="app.runjourney.mobile.test")return
    for((run,count) in losses) {
      val amount=count.getAndSet(0)
      if(amount>0)try{compact(context).loss(run,amount)}catch(_:Exception){count.addAndGet(amount)}
    }
    val unknown=unattributedLoss.getAndSet(0)
    if(unknown>0)try{compact(context).globalLoss(unknown)}catch(_:Exception){unattributedLoss.addAndGet(unknown)}
  }
  private fun store(context: Context): VoiceLogJournal {
    journal?.let { return it }
    // Keep all v32/v34/v35 and candidate v36 chunks immutable during the sensor Test release.
    // Queue, speech and retention policy are unchanged; only Test's new destination differs.
    val markerTest = context.packageName == "app.runjourney.mobile.test"
    val target = File(context.filesDir, if (markerTest) "voice-log-feedback-v36" else "voice-log-v2")
    if (!markerTest) VoiceLogJournal.migrateLegacy(target, {
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
      if(context.packageName=="app.runjourney.mobile.test")try{compact(context.applicationContext).append(payload,timestamp)}catch(e:Exception){Log.w("RunAnnouncer","Compact trace unavailable",e)}
      flushLosses(context.applicationContext)
    } } catch (e: Exception) {
      if(context.packageName=="app.runjourney.mobile.test") {
        val run=CompactVoiceTrace.run(payload)
        synchronized(losses) {
          if(run.isNotBlank() && run.length<=512 && (losses.containsKey(run) || losses.size<128))losses.computeIfAbsent(run){AtomicLong()}.incrementAndGet()
          else unattributedLoss.incrementAndGet()
        }
      }
      Log.w("RunAnnouncer", "Voice journal backlog full", e)
    }
  }
  fun compactStats(context:Context,runId:String,promise:Promise) {
    if(context.packageName!="app.runjourney.mobile.test"){promise.reject("TEST_ONLY","Test only",null);return}
    try{worker.execute{try{flushLosses(context);promise.resolve(org.json.JSONObject(compact(context).stats(runId))
      .put("pendingQueueDrops",losses[runId]?.get() ?: 0).put("pendingUnattributedQueueDrops",unattributedLoss.get()).toString())}catch(e:Exception){promise.reject("COMPACT_STATS_FAILED","Compact trace unavailable",e)}}}
    catch(e:Exception){promise.reject("COMPACT_BUSY","Compact trace busy; loss flags remain pending",e)}
  }
  fun compactPage(context:Context,runId:String,offset:Long,end:Long,promise:Promise) {
    if(context.packageName!="app.runjourney.mobile.test"){promise.reject("TEST_ONLY","Test only",null);return}
    try{worker.execute{try{promise.resolve(compact(context).page(runId,offset,end))}catch(e:Exception){promise.reject("COMPACT_PAGE_FAILED",e.message,e)}}}
    catch(e:Exception){promise.reject("COMPACT_BUSY","Compact trace busy",e)}
  }
  fun read(context: Context, limit: Int, promise: Promise) {
    try { worker.execute {
      try { promise.resolve(store(context.applicationContext).read(limit, System.currentTimeMillis())) }
      catch (e: Exception) { promise.reject("VOICE_LOG_READ", e.message, e) }
    } } catch (e: Exception) { promise.reject("VOICE_LOG_BUSY", e.message, e) }
  }
}
