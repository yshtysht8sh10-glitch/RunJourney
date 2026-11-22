package app.runjourney.announcer

import android.content.Context
import android.util.AtomicFile
import java.io.File
import org.json.JSONObject

/** Fixed boundary + at most one unplayed clock notice, committed together. */
internal class ClockPeriodicLedger(context:Context,private val writeOverride:((String)->Boolean)?=null) {
  companion object { private val lock=Any() }
  private val file=AtomicFile(File(context.filesDir,"clock-periodic-v1.json"))
  private val legacy=context.getSharedPreferences(RunAnnouncerService.PREFS,0)
  fun snapshot():JSONObject = synchronized(lock) {
    try{JSONObject(file.openRead().bufferedReader().use{it.readText()})}
    catch(_:java.io.FileNotFoundException){
      val pending=legacy.getString("clockPending",null)?.let{JSONObject(it)}
      JSONObject().put("runId",pending?.optJSONObject("data")?.optString("runId") ?: "")
        .put("startedAt",legacy.getLong("clockStarted",0)).put("minutes",legacy.getInt("clockMinutes",10))
        .put("enabled",legacy.getBoolean("clockEnabled",false)).put("boundary",legacy.getLong("clockBoundary",0))
        .apply{if(pending!=null)put("pending",pending)}
    }
  }
  private fun save(s:JSONObject):Boolean = synchronized(lock) {
    writeOverride?.let{return it(s.toString())}
    var stream:java.io.FileOutputStream?=null
    try{val bytes=s.toString().toByteArray(Charsets.UTF_8);stream=file.startWrite();stream.write(bytes);stream.fd.sync();file.finishWrite(stream);file.openRead().use{it.readBytes().contentEquals(bytes)}}
    catch(_:Exception){file.failWrite(stream);false}
  }
  fun configure(run:String,c:JSONObject,now:Long):Boolean {
    val s=snapshot();val started=c.optLong("startedAt");val minutes=c.optInt("minutes",10);val enabled=c.optBoolean("enabled")
    if(started<=0 || minutes !in listOf(5,10,15,30))return false
    if(s.optString("runId")==run && s.optLong("startedAt")==started && s.optInt("minutes")==minutes && s.optBoolean("enabled")==enabled)return true
    val next=JSONObject().put("runId",run).put("startedAt",started).put("minutes",minutes).put("enabled",enabled)
      .put("boundary",CurrentTimePolicy.boundary(started,now,minutes)).put("cancelReason",if(enabled)"CONFIG_CHANGED" else "SETTING_OFF")
      .put("unknownCompletionCount",if(s.optString("runId")==run)s.optLong("unknownCompletionCount") else 0)
    return save(next)
  }
  fun receive(due:Long,n:JSONObject):Boolean {
    val s=snapshot()
    if(!s.optBoolean("enabled") || s.optString("runId")!=n.optJSONObject("data")?.optString("runId"))return false
    if(due<=s.optLong("boundary"))return true
    return save(s.put("boundary",due).put("pending",JSONObject(n.toString())))
  }
  fun pending(run:String):JSONObject? {
    val s=snapshot();if(!s.optBoolean("enabled") || s.optString("runId")!=run)return null
    return s.optJSONObject("pending")?.let{JSONObject(it.toString())}
  }
  fun complete(id:String):Boolean {
    val s=snapshot();var changed=false
    for(key in listOf("pending","inflight"))if(s.optJSONObject(key)?.optString("id")==id){s.remove(key);changed=true}
    return !changed || save(s)
  }
  fun end(run:String):Boolean {
    val s=snapshot();if(s.optString("runId")!=run)return true
    s.remove("pending");s.remove("inflight");return save(s.put("enabled",false).put("cancelReason","RUN_ENDED"))
  }
  fun bodyRequested(id:String,at:Long,notice:JSONObject?=null):Boolean {
    val s=snapshot()
    s.optJSONObject("inflight")?.let{return it.optString("id")==id}
    val p=s.optJSONObject("pending")?.takeIf{it.optString("id")==id}
      ?: notice?.takeIf{it.optString("id")==id && it.optString("type")=="CURRENT_TIME" && it.optJSONObject("data")?.optString("runId")==s.optString("runId")}
      ?.let{JSONObject(it.toString())} ?: return false
    p.put("attemptState","BODY_REQUESTED").put("bodyRequestedAt",at)
    return save(s.put("inflight",JSONObject(p.toString())))
  }
  fun recoverUnknown():Pair<Boolean,JSONObject?> {
    val s=snapshot();val p=s.optJSONObject("inflight") ?: s.optJSONObject("pending") ?: return true to null
    if(p.optString("attemptState")!="BODY_REQUESTED")return true to null
    s.remove("inflight")
    if(s.optJSONObject("pending")?.optString("id")==p.optString("id"))s.remove("pending")
    s.put("unknownCompletionCount",s.optLong("unknownCompletionCount")+1).put("lastUnknownId",p.optString("id"))
    return if(save(s))true to p else false to null
  }
}
