package app.runjourney.announcer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class PeriodicVoiceQueueTest {
  private lateinit var service:RunAnnouncerService
  private fun get(name:String)=service.javaClass.getDeclaredField(name).apply{isAccessible=true}.get(service)
  private fun set(name:String,value:Any?)=service.javaClass.getDeclaredField(name).apply{isAccessible=true}.set(service,value)
  @Suppress("UNCHECKED_CAST") private fun queue()=get("messages") as MutableList<JSONObject>
  private fun batch(state:String="RUNNING", index:Int=1, ended:Boolean=false, notices:List<JSONObject> = emptyList()) {
    val now=System.currentTimeMillis()
    val b=JSONObject().put("runId","r").put("state",state).put("paused",state!="RUNNING").put("latestEventIndex",index).put("ended",ended)
      .put("paceSchedule",JSONObject().put("version",1).put("runId","r").put("configKey","a").put("startedAt",now).put("intervalMs",60000).put("enabled",!ended))
      .put("notices",JSONArray(notices))
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,b.toString())
  }
  private fun pace(slot:Int)=JSONObject().put("id","p$slot").put("type","PACE_WARNING").put("priority",20).put("message","slot $slot").put("expiresAt",1)
    .put("data",JSONObject().put("runId","r").put("pacePeriodicSnapshot",JSONObject().put("version",1).put("runId","r").put("configKey","a").put("slot",slot).put("quality","READY")))
  @Before fun setup(){
    service=Robolectric.buildService(RunAnnouncerService::class.java).create().get()
    listOf("runjourney-pace-periodic-v1","runjourney-voice-debug",RunAnnouncerService.PREFS).forEach{service.getSharedPreferences(it,Context.MODE_PRIVATE).edit().clear().commit()}
    set("ready",false)
  }
  @After fun teardown(){service.onDestroy()}
  @Test fun immutablePaceSurvivesPauseTtlSameTypeAndDeferredReplacement(){
    batch("AUTO_STOP",notices=listOf(pace(1),pace(2)))
    assertEquals(listOf("slot 1","slot 2"),queue().map{it.getString("message")})
    assertTrue(queue().all{it.getLong("expiresAt")==Long.MAX_VALUE && !it.optBoolean("deferred")})
    set("ready",true);service.javaClass.getDeclaredMethod("speakNext").apply{isAccessible=true}.invoke(service)
    assertNull(get("currentNotice"));assertEquals(2,queue().size)
    set("ready",false);batch("RUNNING",index=2)
    assertEquals(listOf("slot 1","slot 2"),queue().map{it.getString("message")})
    batch(ended=true,index=3);assertTrue(queue().isEmpty());assertTrue(PacePeriodicLedger(service).pending("r").isEmpty())
  }
  @Test fun oldBatchCannotRegressStopStateOrCancelCurrentStopAnnouncement(){
    batch("AUTO_STOP",index=5)
    val current=JSONObject().put("id","stop").put("type","AUTO_STOP_CONFIRMED").put("message","stop").put("priority",100)
      .put("data",JSONObject().put("runId","r").put("eventIndex",5))
    set("currentNotice",current);set("speaking",true)
    batch("RUNNING",index=4)
    assertEquals("AUTO_STOP",get("batchState"));assertEquals(5,get("latestEventIndex"));assertSame(current,get("currentNotice"))
  }
  @Test fun fullPaceLedgerDoesNotConsumeImportantTransitionQueueCapacity(){
    batch(notices=(1..32).map{pace(it)})
    val stop=JSONObject().put("id","stop").put("type","AUTO_STOP_CONFIRMED").put("priority",100).put("message","stop")
      .put("expiresAt",System.currentTimeMillis()+30000).put("data",JSONObject().put("runId","r").put("eventIndex",2))
    batch("AUTO_STOP",index=2,notices=listOf(stop))
    assertEquals(33,queue().size);assertTrue(queue().any{it.optString("id")=="stop"})
    assertEquals(32,PacePeriodicLedger(service).pending("r").size)
  }
  @Test fun clockLateBusyPausedAndUnreadyWaitAndMergeOneUnplayedNotice(){
    batch("AUTO_STOP")
    val prefs=service.getSharedPreferences(RunAnnouncerService.PREFS,Context.MODE_PRIVATE)
    val now=System.currentTimeMillis()
    prefs.edit().putBoolean("clockEnabled",true).putLong("clockStarted",now-605000).putInt("clockMinutes",10).putLong("clockBoundary",0).commit()
    (get("clockTick") as Runnable).run()
    assertEquals(1,queue().size);assertEquals(Long.MAX_VALUE,queue().single().getLong("expiresAt"))
    prefs.edit().putLong("clockBoundary",0).commit();(get("clockTick") as Runnable).run()
    assertEquals(1,queue().size);assertEquals("CURRENT_TIME",queue().single().getString("type"))
  }
}
