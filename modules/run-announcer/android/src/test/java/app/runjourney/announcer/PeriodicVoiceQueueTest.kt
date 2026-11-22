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
  private fun batch(state:String="RUNNING", index:Int=1, ended:Boolean=false, notices:List<JSONObject> = emptyList(), enabled:Boolean=true) {
    val now=System.currentTimeMillis()
    val b=JSONObject().put("runId","r").put("state",state).put("paused",state!="RUNNING").put("latestEventIndex",index).put("ended",ended)
      .put("paceSchedule",JSONObject().put("version",1).put("runId","r").put("configKey","a").put("startedAt",now).put("intervalMs",60000).put("enabled",enabled && !ended))
      .put("notices",JSONArray(notices))
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,b.toString())
  }
  private fun pace(slot:Int)=JSONObject().put("id","p$slot").put("type","PACE_WARNING").put("priority",20).put("message","slot $slot").put("expiresAt",1)
    .put("data",JSONObject().put("runId","r").put("pacePeriodicSnapshot",JSONObject().put("version",1).put("runId","r").put("configKey","a").put("slot",slot).put("quality","READY")))
  @Before fun setup(){
    service=Robolectric.buildService(RunAnnouncerService::class.java).create().get()
    android.util.AtomicFile(java.io.File(service.filesDir,"pace-periodic-v1.json")).delete()
    listOf("runjourney-pace-periodic-v1","runjourney-voice-debug",RunAnnouncerService.PREFS).forEach{service.getSharedPreferences(it,Context.MODE_PRIVATE).edit().clear().commit()}
    set("ready",false)
  }
  @After fun teardown(){service.onDestroy();NoiseState.running=false;NoiseState.playback=false}
  private fun call(name:String)=service.javaClass.getDeclaredMethod(name).apply{isAccessible=true}.invoke(service)
  @Test fun completedSpeechIsNotReplayedWhenTerminalPersistenceFails(){
    batch(notices=listOf(pace(1)))
    set("currentNotice",queue().removeAt(0));set("speaking",true)
    set("paceLedgerOverride",PacePeriodicLedger(service){false})
    service.javaClass.getDeclaredMethod("finishUtterance",String::class.java).apply{isAccessible=true}.invoke(service,"DONE")
    assertTrue(get("pacePersistenceBlocked") as Boolean)
    batch();assertTrue(queue().isEmpty());assertEquals(1,PacePeriodicLedger(service).pending("r").size)
    set("paceLedgerOverride",null);assertEquals(true,call("flushPacePersistence"))
    batch();assertTrue(queue().isEmpty());assertTrue(PacePeriodicLedger(service).pending("r").isEmpty())
  }
  @Test fun serviceRestartSuppressesAttemptedBodyButKeepsNeverAttemptedSnapshot(){
    batch(notices=listOf(pace(1),pace(2)))
    val first=queue().removeAt(0);set("currentNotice",first);set("speaking",true)
    assertEquals(true,service.javaClass.getDeclaredMethod("preparePaceBody",JSONObject::class.java).apply{isAccessible=true}.invoke(service,first))
    service.onDestroy();service=Robolectric.buildService(RunAnnouncerService::class.java).create().get();set("ready",false)
    batch();assertEquals(listOf("p2"),queue().map{it.getString("id")})
    assertEquals(1,JSONObject(PacePeriodicLedger(service).state("r","a")).getInt("unknownCompletionCount"))
  }
  @Test fun bodyAttemptWriteFailureBlocksOnlyPaceBeforeOutputAndCanRecover(){
    batch(notices=listOf(pace(1)))
    val first=queue().removeAt(0);set("currentNotice",first);set("speaking",true)
    set("paceLedgerOverride",PacePeriodicLedger(service){false})
    assertEquals(false,service.javaClass.getDeclaredMethod("preparePaceBody",JSONObject::class.java).apply{isAccessible=true}.invoke(service,first))
    assertNull(get("currentNotice"));assertTrue(get("pacePersistenceBlocked") as Boolean)
    assertFalse(PacePeriodicLedger(service).pending("r").single().has("attemptState"))
    set("paceLedgerOverride",null);assertEquals(true,call("flushPacePersistence"))
    assertEquals("BODY_REQUESTED",PacePeriodicLedger(service).pending("r").single().getString("attemptState"))
  }
  @Test fun offPersistenceFailureSuppressesOldSnapshotsUntilDurableRetry(){
    batch(notices=listOf(pace(1)))
    service.getSharedPreferences(RunAnnouncerService.PREFS,0).edit().putBoolean("running",true).commit()
    set("paceLedgerOverride",PacePeriodicLedger(service){false});batch(enabled=false)
    assertTrue(get("pacePersistenceBlocked") as Boolean);assertTrue(queue().isEmpty())
    assertEquals(1,PacePeriodicLedger(service).pending("r").size)
    assertTrue(service.getSharedPreferences(RunAnnouncerService.PREFS,0).getBoolean("running",false))
    set("paceLedgerOverride",null);assertEquals(true,call("flushPacePersistence"));assertTrue(PacePeriodicLedger(service).pending("r").isEmpty())
  }
  @Test fun offOnWhileStorageFailsStillCancelsPreviousEpochBeforeRearming(){
    batch(notices=listOf(pace(1)));set("paceLedgerOverride",PacePeriodicLedger(service){false})
    batch(enabled=false);batch(enabled=true)
    assertTrue(queue().isEmpty());assertTrue(get("pacePersistenceBlocked") as Boolean)
    set("paceLedgerOverride",null);assertEquals(true,call("flushPacePersistence"))
    batch();assertTrue(queue().isEmpty());assertTrue(PacePeriodicLedger(service).pending("r").isEmpty())
  }
  @Test fun endPersistenceFailureDoesNotRestoreSpeechAndRetrySealsCancellation(){
    batch(notices=listOf(pace(1)));set("paceLedgerOverride",PacePeriodicLedger(service){false})
    val b=JSONObject().put("runId","r").put("ended",true).put("latestEventIndex",2).put("notices",JSONArray())
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,b.toString())
    assertTrue(get("pacePersistenceBlocked") as Boolean);assertTrue(queue().isEmpty())
    set("paceLedgerOverride",null);assertEquals(true,call("flushPacePersistence"));assertTrue(PacePeriodicLedger(service).pending("r").isEmpty())
  }
  @Test fun noiseEnabledClockUsesFreshDirectWordingAfterMinuteBoundary(){
    batch()
    val clock=JSONObject().put("id","clock").put("type","CURRENT_TIME").put("message","CURRENT_TIME_AT_PLAYBACK").put("expiresAt",Long.MAX_VALUE)
      .put("data",JSONObject().put("runId","r"))
    set("currentNotice",clock)
    NoiseState.running=true;NoiseState.updatedAt=System.currentTimeMillis();NoiseState.gain=.75f
    org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofSeconds(61))
    NoiseState.updatedAt=System.currentTimeMillis()
    val attributes=android.media.AudioAttributes.Builder().build()
    service.javaClass.getDeclaredMethod("synthesizeAdaptive",JSONObject::class.java,android.media.AudioAttributes::class.java).apply{isAccessible=true}.invoke(service,clock,attributes)
    assertNull(get("speechFile"));assertEquals("direct-tts",clock.getString("playbackMode"))
    assertEquals(CurrentTimePolicy.message(System.currentTimeMillis()),clock.getString("message"))
    assertEquals(1.0,clock.getDouble("directRequestedGain"),.001) // Existing CLOCK gain policy unchanged.
    assertEquals(clock.getString("message"),org.robolectric.Shadows.shadowOf(get("tts") as android.speech.tts.TextToSpeech).lastSpokenText)
  }
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
