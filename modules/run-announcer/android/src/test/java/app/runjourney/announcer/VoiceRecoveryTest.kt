package app.runjourney.announcer

import android.content.Context
import android.media.MediaPlayer
import android.os.Looper
import android.speech.tts.TextToSpeech
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowMediaPlayer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.junit.runner.RunWith

/** Exercises the real Android service queue with Android audio replaced by shadows. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class VoiceRecoveryTest {
  private lateinit var service: RunAnnouncerService
  private fun set(name: String, value: Any?) { service.javaClass.getDeclaredField(name).apply { isAccessible = true }.set(service, value) }
  private fun get(name: String): Any? = service.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(service)
  @Suppress("UNCHECKED_CAST") private fun queue() = get("messages") as MutableList<JSONObject>
  private fun notice(type: String, id: String = type, index: Int = 0) = JSONObject().put("id", id).put("type", type)
    .put("message", "test").put("priority", when(type) { "RUN_GOAL_FINISHED" -> 110; "AUTO_STOP_CONFIRMED", "AUTO_RESUME_CONFIRMED" -> 100; "STOP_CANDIDATE_ANNOUNCED" -> 80; "KILOMETER_LAP" -> 70; "FIVE_MINUTES" -> 40; else -> 20 })
    .put("expiresAt", System.currentTimeMillis() + 30000).put("data", JSONObject().put("runId", "r").put("eventIndex", index))
  private fun batch(state: String = "RUNNING", vararg notices: JSONObject, ended: Boolean = false, candidate: Boolean = false, index: Int = 0) {
    val payload = JSONObject().put("runId", "r").put("state", state).put("paused", state != "RUNNING")
      .put("ended", ended).put("cancelCandidate", !candidate).put("latestEventIndex", index).put("notices", JSONArray(notices.toList()))
    service.javaClass.getDeclaredMethod("receiveBatch", String::class.java).apply { isAccessible = true }.invoke(service, payload.toString())
  }
  @Before fun setup() {
    NoiseState.running = false; NoiseState.playback = false
    ShadowMediaPlayer.setMediaInfoProvider { ShadowMediaPlayer.MediaInfo(320, 0) }
    service = Robolectric.buildService(RunAnnouncerService::class.java).create().get()
    service.getSharedPreferences("runjourney-voice-debug", Context.MODE_PRIVATE).edit().clear().commit()
    set("ready", false)
  }
  @Test fun paceBaselineUpdatesOnlyWhenRealBodyStarts() {
    val preferences = service.getSharedPreferences(RunAnnouncerService.PREFS, Context.MODE_PRIVATE)
    preferences.edit().remove("paceAnnouncementBaseline").commit()
    val sample = JSONObject().put("runId", "r").put("at", 60000).put("savings", 12).put("meters", 1000).put("target", 360)
    val event = notice("PACE_WARNING")
    event.getJSONObject("data").put("paceSample", sample)
    val audit = service.javaClass.getDeclaredMethod("audit", JSONObject::class.java, String::class.java).apply { isAccessible = true }
    audit.invoke(service, event, "EXPIRED")
    assertNull(preferences.getString("paceAnnouncementBaseline", null))
    event.getJSONObject("data").put("simulation", true)
    audit.invoke(service, event, "STARTED")
    assertNull(preferences.getString("paceAnnouncementBaseline", null))
    event.getJSONObject("data").remove("simulation")
    audit.invoke(service, event, "STARTED")
    assertEquals(sample.toString(), preferences.getString("paceAnnouncementBaseline", null))
  }

  @After fun destroy() { service.onDestroy(); NoiseState.running = false }
  private fun cueBatch(label:Int, version:Int=1, enabled:Boolean=true, state:String="RUNNING", time:Boolean=false, remaining:Double=label.toDouble(), at:Long=System.currentTimeMillis()) {
    val n=notice("GOAL_COUNTDOWN","countdown-$label-$version").put("expiresAt",System.currentTimeMillis()+3000).apply {getJSONObject("data").put("goalRevision","cue").put("goalEpoch",0).put("cueVersion",version).put("label",label)}
    val context=JSONObject().put("at",at).put("version",version).put("revision","cue").put("enabled",true).put("running",state=="RUNNING")
      .put("turnaround",enabled).put("countdown",enabled).put("suppressWarning",enabled).put("kind",if(time)"time" else "distance").put("remaining",remaining).put("deadline",if(time)System.currentTimeMillis()+(remaining*1000).toLong() else 0)
    val payload=JSONObject().put("runId","r").put("state",state).put("goalRevision","cue").put("goalRevisionIndex",0).put("cueContext",context).put("notices",JSONArray().put(n))
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,payload.toString())
  }
  @Test fun countdownKeepsOneLatestQueueEntryAndRejectsOldNumbers() {
    cueBatch(200);cueBatch(190);cueBatch(200,at=System.currentTimeMillis()-1000)
    assertEquals(1,queue().size);assertEquals(190,queue().single().getJSONObject("data").getInt("label"))
  }
  @Test fun countdownOnlyFirstActualNotificationChimesEvenAfterServiceRestart() {
    set("ready",true);cueBatch(200);assertTrue(get("chimeActive") as Boolean);finishCommonChime()
    cueBatch(190);assertFalse(get("chimeActive") as Boolean)
    service.onDestroy();service=Robolectric.buildService(RunAnnouncerService::class.java).create().get();set("ready",true)
    cueBatch(180);assertFalse(get("chimeActive") as Boolean)
    assertEquals("test",shadowOf(get("tts") as TextToSpeech).lastSpokenText)
  }
  @Test fun countdownOffCancelsAndStaleConfigurationCannotReenableIt() {
    cueBatch(200);cueBatch(190,version=2,enabled=false);cueBatch(180,version=1)
    assertTrue(queue().isEmpty())
  }
  @Test fun sameGoalValueAfterTwoEditsRejectsOldEpochCountdown() {
    cueBatch(200);set("goalRevisionIndex",2);cueBatch(190)
    assertTrue(queue().isEmpty())
  }
  @Test fun finishedCueMarkerRejectsLateCountdownWithoutDisablingGenericVoiceResume() {
    cueBatch(200)
    assertTrue(GoalCueFence.finish(service,"r"))
    RunAnnouncerService.stopRunning!!.invoke();shadowOf(Looper.getMainLooper()).idle()
    set("ready",false);cueBatch(190)
    assertTrue(queue().isEmpty())
    service.onDestroy();service=Robolectric.buildService(RunAnnouncerService::class.java).create().get();set("ready",false)
    cueBatch(180);assertTrue(queue().isEmpty())
  }
  @Test fun previewLeaseIsBoundedWithoutChangingTheRealRunningPreference() {
    val payload=JSONObject().put("runId","preview-cues-lease").put("state","RUNNING").put("previewLeaseMs",999999).put("notices",JSONArray())
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,payload.toString())
    assertFalse(service.getSharedPreferences(RunAnnouncerService.PREFS,0).getBoolean("running",false))
    assertTrue((get("cuePreviewUntil") as Long)-System.currentTimeMillis()<=30000)
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(30001))
    assertEquals(0L,get("cuePreviewUntil"));assertTrue(queue().isEmpty());assertNull(get("currentNotice"))
  }
  @Test fun countdownSuppressesExistingWarningOnlyInsideConfiguredRange() {
    cueBatch(200)
    val warning=notice("GOAL_WARNING").apply{getJSONObject("data").put("goalRevision","cue")}
    val p=JSONObject().put("runId","r").put("state","RUNNING").put("goalRevision","cue").put("notices",JSONArray().put(warning))
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,p.toString())
    assertFalse(queue().any{it.optString("type")=="GOAL_WARNING"})
  }
  @Test fun pauseAndRunEndCancelCountdownWithoutInformationRecovery() {
    set("ready",true);cueBatch(200);cueBatch(190,state="AUTO_STOP")
    assertNull(get("currentNotice"));assertTrue(queue().isEmpty())
    cueBatch(180);batch("RUNNING",notice("RUN_GOAL_FINISHED"),ended=true)
    assertFalse(queue().any{it.optString("type")=="GOAL_COUNTDOWN"})
  }
  @Test fun timeGoalDeadlineCancelsChimeWithoutChangingRunEndState() {
    set("ready",true);cueBatch(10,time=true,remaining=.2)
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(250))
    assertNull(get("currentNotice"));assertFalse(get("ended") as Boolean);assertFalse(get("chimeActive") as Boolean)
  }
  @Test fun startedCountdownSurvivesDeliveryDeadlineButRemainsBounded() {
    set("ready",true);cueBatch(200)
    val n=get("currentNotice") as JSONObject
    // Keep the test engine silent; explicitly deliver onStart after device-like latency.
    (get("chime") as MediaPlayer).release();set("chime",null);set("chimeActive",false)
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(1500))
    service.javaClass.getDeclaredMethod("cueBodyStarted", JSONObject::class.java, java.lang.Long.TYPE)
      .apply { isAccessible=true }.invoke(service,n,System.currentTimeMillis())
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(1600))
    assertSame(n,get("currentNotice"))
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(3500))
    assertNull(get("currentNotice"))
  }
  @Test fun startedCountdownStillStopsAtTimeGoalDeadline() {
    set("ready",true);cueBatch(10,time=true,remaining=2.0)
    val n=get("currentNotice") as JSONObject
    service.javaClass.getDeclaredMethod("cueBodyStarted", JSONObject::class.java, java.lang.Long.TYPE)
      .apply { isAccessible=true }.invoke(service,n,System.currentTimeMillis())
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(2001))
    assertNull(get("currentNotice"));assertFalse(get("ended") as Boolean)
  }
  @Test fun newerCountdownStillCancelsStartedOlderBodyAfterDeliveryWindow() {
    set("ready",true);cueBatch(200)
    val n=get("currentNotice") as JSONObject
    (get("chime") as MediaPlayer).release();set("chime",null);set("chimeActive",false)
    service.javaClass.getDeclaredMethod("cueBodyStarted", JSONObject::class.java, java.lang.Long.TYPE)
      .apply {isAccessible=true}.invoke(service,n,System.currentTimeMillis())
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(3100))
    cueBatch(190)
    assertNotSame(n,get("currentNotice"));assertFalse(queue().any{it.optString("id")==n.optString("id")})
  }
  @Test fun liveRunFreshCountdownIsNotSubjectToThirtySecondPreviewLease() {
    cueBatch(200)
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(310000))
    cueBatch(190)
    assertEquals(190,queue().single().getJSONObject("data").getInt("label"))
    assertFalse(GoalCueFence.ended(service,"r"))
  }
  private fun finishCommonChime() {
    (get("chime") as? MediaPlayer)?.let { shadowOf(it).invokeCompletionListener() }
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(181))
  }
  @Test fun commonChimeAndGapKeepBodyInSameNotice() {
    for(type in listOf("KILOMETER_LAP","FIVE_MINUTES","PACE_WARNING","RUN_STARTED","GOAL_WARNING")) {
      set("ready",true)
      val n=notice(type,"normal-$type").apply {getJSONObject("data").put("goalRevision","")}
      batch("RUNNING",n)
      val current=get("currentNotice") as JSONObject
      assertEquals("common-v1",current.optString("chimeKind"));assertTrue(current.optBoolean("chimePlayed"))
      val player=get("chime") as MediaPlayer
      shadowOf(player).invokeCompletionListener()
      assertSame(current,get("currentNotice"));assertTrue(get("speaking") as Boolean)
      shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(179))
      assertFalse(current.has("startedAt"))
      shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(2))
      // Shadow TTS completes automatically; body and chime share the original ID.
      assertEquals("test",shadowOf(get("tts") as TextToSpeech).lastSpokenText)
      set("ready",false)
    }
  }
  @Test fun finishDuringCommonChimeCancelsOldBodyImmediately() {
    set("ready",true);batch("RUNNING",notice("RUN_STARTED","old-start"))
    val old=get("currentNotice") as JSONObject
    batch("RUNNING",notice("RUN_GOAL_FINISHED"),ended=true)
    assertNotSame(old,get("currentNotice"));assertEquals("RUN_GOAL_FINISHED",(get("currentNotice") as JSONObject).optString("type"))
    finishCommonChime();assertNotEquals("old-start",(get("currentNotice") as? JSONObject)?.optString("id"))
  }
  @Test fun ordinaryHigherPriorityDoesNotDropCommonChimeBody() {
    set("ready",true);batch("RUNNING",notice("FIVE_MINUTES","five-first"))
    val first=get("currentNotice") as JSONObject
    batch("RUNNING",notice("KILOMETER_LAP","km-next"))
    assertSame(first,get("currentNotice"));assertFalse(queue().single().optBoolean("deferred"))
    finishCommonChime()
    assertEquals("five-first",first.optString("id"));assertTrue(first.has("startedAt"))
  }
  @Test fun expiredSynthesisFallbackCannotStartBodyAfterCommonChime() {
    NoiseState.running=true;NoiseState.updatedAt=System.currentTimeMillis();NoiseState.gain=.8f
    set("ready",true);batch("RUNNING",notice("RUN_STARTED","synthesis-expiry"))
    val first=get("currentNotice") as JSONObject
    finishCommonChime();assertTrue(first.has("synthesisKey"))
    val listener=shadowOf(get("tts") as TextToSpeech).utteranceProgressListener
    first.put("expiresAt",System.currentTimeMillis()-1)
    listener.onError(first.getString("synthesisKey"));shadowOf(Looper.getMainLooper()).idle()
    assertNull(get("currentNotice"));assertNull(get("speechFile"));assertFalse(first.has("startedAt"))
  }
  @Test fun expiryInCommonGapCannotStartBodyAndFailureStillAllowsBody() {
    set("ready",true);val n=notice("RUN_STARTED")
    batch("RUNNING",n);val p=get("chime") as MediaPlayer
    (get("currentNotice") as JSONObject).put("expiresAt",System.currentTimeMillis()+100)
    shadowOf(p).invokeCompletionListener();shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(181))
    assertNull(get("currentNotice"))
    batch("RUNNING",notice("RUN_STARTED","failure"));val next=get("chime") as MediaPlayer
    shadowOf(next).invokeErrorListener(1,0);shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(181))
    assertEquals("test",shadowOf(get("tts") as TextToSpeech).lastSpokenText)
  }
  @Test fun currentClockConsumesPausedOrBusyBoundariesWithoutReplay() {
    val prefs = service.getSharedPreferences(RunAnnouncerService.PREFS, 0)
    batch("AUTO_STOP")
    prefs.edit().putBoolean("clockEnabled", true).putLong("clockStarted", System.currentTimeMillis()-600000).putInt("clockMinutes",10).putLong("clockBoundary",0).commit()
    (get("clockTick") as Runnable).run()
    assertEquals(1L,prefs.getLong("clockBoundary",0)); assertTrue(queue().isEmpty())
    batch("RUNNING"); (get("clockTick") as Runnable).run(); assertTrue(queue().isEmpty())
    prefs.edit().putLong("clockStarted",System.currentTimeMillis()-1200000).commit()
    set("speaking",true); (get("clockTick") as Runnable).run()
    assertEquals(2L,prefs.getLong("clockBoundary",0)); assertTrue(queue().isEmpty())
    set("speaking",false); (get("clockTick") as Runnable).run(); assertTrue(queue().isEmpty())
  }
  @Test fun currentClockIsDiscardedOnStopRatherThanDeferredOrRetried() {
    batch("RUNNING",notice("CURRENT_TIME"))
    assertEquals(1,queue().size)
    batch("AUTO_STOP"); assertTrue(queue().isEmpty())
    batch("RUNNING"); set("currentNotice",notice("CURRENT_TIME")); set("speaking",true)
    batch("AUTO_STOP",notice("AUTO_STOP_CONFIRMED"))
    assertFalse(queue().any { it.optString("type")=="CURRENT_TIME" })
  }
  @Test fun interruptedFiveMinuteKilometerAndSavingsAreRetainedOnce() {
    for (type in listOf("FIVE_MINUTES", "KILOMETER_LAP", "PACE_WARNING")) {
      queue().clear(); set("currentNotice", notice(type)); set("speaking", true)
      batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED", "stop-$type"))
      val deferred = queue().single { it.optString("type") == type }
      assertEquals(1, deferred.optInt("retry")); assertTrue(deferred.optBoolean("deferred"))
      assertEquals(type, deferred.optString("originalId"))
      queue().clear(); set("currentNotice", deferred); set("speaking", true)
      batch("RUNNING", notice("AUTO_RESUME_CONFIRMED", "resume-$type", 1), index = 1)
      assertFalse(queue().any { it.optString("type") == type })
    }
  }
  @Test fun chimeIsAtomicEvenForFinishAndStateChanges() {
    batch("AUTO_STOP")
    val stop = notice("AUTO_STOP_CONFIRMED")
    set("currentNotice", stop); set("speaking", true); set("chimeActive", true)
    batch("RUNNING", notice("AUTO_RESUME_CONFIRMED", index = 1), index = 1)
    assertSame(stop, get("currentNotice")); assertTrue(get("speaking") as Boolean)
    batch("RUNNING", notice("RUN_GOAL_FINISHED"), ended = true)
    assertSame(stop, get("currentNotice")); assertTrue(get("chimeActive") as Boolean)
    assertEquals(listOf("RUN_GOAL_FINISHED"), queue().map { it.optString("type") })
  }
  @Test fun periodicNoticesDuringEitherChimeAreDeferredAndBounded() {
    for (state in listOf("AUTO_STOP", "RUNNING")) {
      queue().clear(); set("currentNotice",notice(if(state=="AUTO_STOP") "AUTO_STOP_CONFIRMED" else "AUTO_RESUME_CONFIRMED")); set("chimeActive", true); set("speaking", true)
      batch(state, notice("FIVE_MINUTES", "$state-five1"), notice("KILOMETER_LAP", "$state-km"), notice("PACE_WARNING", "$state-pace"))
      assertEquals(3, queue().size); assertTrue(queue().all { it.optBoolean("deferred") })
      batch(state, notice("FIVE_MINUTES", "$state-five2"))
      assertEquals(3, queue().size); assertFalse(queue().any { it.optString("id") == "$state-five1" })
    }
  }
  @Test fun obsoleteHintAndTransitionsAreRemovedOnResume() {
    batch("RUNNING", notice("STOP_CANDIDATE_ANNOUNCED"), candidate = true)
    assertEquals(1, queue().size)
    batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED"))
    assertEquals(listOf("AUTO_STOP_CONFIRMED"), queue().map { it.optString("type") })
    batch("RUNNING", notice("AUTO_RESUME_CONFIRMED", index = 1), index = 1)
    assertEquals(listOf("AUTO_RESUME_CONFIRMED"), queue().map { it.optString("type") })
  }
  @Test fun goalDiscardsPeriodicAndDuplicateMessages() {
    batch("RUNNING", notice("FIVE_MINUTES"), notice("KILOMETER_LAP"))
    batch("RUNNING", notice("FIVE_MINUTES"))
    assertEquals(2, queue().size)
    batch("RUNNING", notice("RUN_GOAL_FINISHED"), ended = true)
    assertEquals(listOf("RUN_GOAL_FINISHED"), queue().map { it.optString("type") })
    batch("RUNNING", notice("FIVE_MINUTES", "late"))
    assertEquals(1, queue().size)
  }
  @Test fun actualChimeCompletionSkipsObsoleteSpeechAndLetsGoalPlay() {
    set("ready", true)
    batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED"))
    val player = get("chime") as MediaPlayer
    assertTrue(get("chimeActive") as Boolean)
    batch("RUNNING", notice("RUN_GOAL_FINISHED"), ended = true)
    assertSame(player, get("chime"))
    shadowOf(player).invokeCompletionListener()
    assertTrue(get("chimeActive") as Boolean) // finish is a new common-chime notification
    assertEquals("RUN_GOAL_FINISHED", (get("currentNotice") as JSONObject).optString("type"))
  }
  @Test fun actualChimeErrorFallsThroughToSpeechWithoutBlockingState() {
    set("ready", true)
    batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED"))
    val player = get("chime") as MediaPlayer
    shadowOf(player).invokeErrorListener(1, 0)
    assertFalse(get("chimeActive") as Boolean)
    assertEquals("AUTO_STOP_CONFIRMED", (get("currentNotice") as JSONObject).optString("type"))
    assertTrue(get("speaking") as Boolean)
  }
  @Test fun chimeTimeoutRecoversAndRapidResumeCannotReplayOldStopSpeech() {
    ShadowMediaPlayer.setMediaInfoProvider { ShadowMediaPlayer.MediaInfo(10000, 0) }
    set("ready", true)
    batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED"))
    val stop = get("chime") as MediaPlayer
    batch("RUNNING", notice("AUTO_RESUME_CONFIRMED", index = 1), index = 1)
    assertSame(stop, get("chime"))
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(2001))
    assertNotSame(stop, get("chime"))
    assertEquals("AUTO_RESUME_CONFIRMED", (get("currentNotice") as JSONObject).optString("type"))
    val resume = get("chime") as? MediaPlayer
    if (resume != null) shadowOf(resume).invokeErrorListener(1, 0)
    assertFalse(get("chimeActive") as Boolean)
  }
  @Test fun deferredInformationIsRegeneratedAndMergedAfterStateSpeech() {
    batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED"), notice("FIVE_MINUTES"), notice("KILOMETER_LAP"), notice("PACE_WARNING"))
    set("recovery", JSONObject().put("message", "fresh current totals").put("data", JSONObject().put("runId", "r").put("sampledAt", System.currentTimeMillis())))
    set("ready", true)
    val transition = queue().removeAt(0)
    set("currentNotice", transition); set("speaking", true)
    service.javaClass.getDeclaredMethod("finishUtterance", String::class.java).apply { isAccessible = true }.invoke(service, "DONE")
    val resumed = get("currentNotice") as JSONObject
    assertEquals("fresh current totals", resumed.optString("message"))
    assertEquals(3, resumed.getJSONArray("recoveryOf").length())
    assertTrue(queue().isEmpty()); assertEquals(1, resumed.optInt("retry"))
  }
  @Test fun disablingVoiceDoesNotPermanentlyFinishAnActiveRun() {
    batch("RUNNING")
    RunAnnouncerService.stopRunning!!.invoke()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals("", service.getSharedPreferences("runjourney-voice-debug", Context.MODE_PRIVATE).getString("finishedRun", ""))
    set("ready", false)
    batch("RUNNING", notice("FIVE_MINUTES", "after-enable"))
    assertEquals("after-enable", queue().single().optString("id"))
  }
  @Test fun synthesisFailureUsesNormalTtsAndRemovesGeneratedFile() {
    val tts = get("tts") as TextToSpeech
    shadowOf(tts).simulateSynthesizeToFileResult(TextToSpeech.ERROR)
    NoiseState.running = true; NoiseState.updatedAt = System.currentTimeMillis(); NoiseState.gain = .8f
    set("ready", true)
    val item = notice("FIVE_MINUTES")
    batch("RUNNING", item)
    val active = get("currentNotice") as JSONObject
    finishCommonChime()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(.8, active.optDouble("directRequestedGain"), .001)
    assertFalse(active.optBoolean("directGainDynamic"))
    assertEquals("test", shadowOf(tts).lastSpokenText)
    assertNull(get("speechFile")); assertNull(get("adaptivePlayer"))
    assertEquals("DONE", service.getSharedPreferences(RunAnnouncerService.PREFS, 0).getString("ttsStatus", ""))
  }
  @Test fun lateSynthesisCallbackCannotResurrectInterruptedInformation() {
    val tts = get("tts") as TextToSpeech
    NoiseState.running = true; NoiseState.updatedAt = System.currentTimeMillis(); NoiseState.gain = .8f
    set("ready", true)
    batch("RUNNING", notice("FIVE_MINUTES"))
    val first = get("currentNotice") as JSONObject
    finishCommonChime()
    val listener = shadowOf(tts).utteranceProgressListener
    val file = get("speechFile") as java.io.File
    batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED"))
    assertFalse(file.exists()); assertNull(get("adaptivePlayer"))
    listener.onDone(first.getString("synthesisKey")); shadowOf(Looper.getMainLooper()).idle()
    assertNull(get("adaptivePlayer"))
    assertEquals("AUTO_STOP_CONFIRMED", (get("currentNotice") as JSONObject).optString("type"))
  }
  @Test fun longSummaryWaitsBeyondThreeSecondsThenFallsBackAndDeletesFile() {
    // No engine callback: exercise the actual service deadline, not only the budget formula.
    val item = notice("FIVE_MINUTES").put("message", "あ".repeat(90))
    set("currentNotice", item); set("speaking", true)
    service.javaClass.getDeclaredMethod("synthesizeAdaptive", JSONObject::class.java, android.media.AudioAttributes::class.java)
      .apply { isAccessible = true }.invoke(service, item, android.media.AudioAttributes.Builder().build())
    val file = get("speechFile") as java.io.File
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(3001))
    assertSame(file, get("speechFile")); assertFalse(item.has("adaptiveFallback"))
    shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(2400))
    assertEquals("SYNTHESIS_TIMEOUT", item.optString("adaptiveFallback"))
    assertNull(get("speechFile")); assertFalse(file.exists())
  }
  @Test fun candidateChimeAlsoWaitsForCompletionButNeverSpeaksAfterConfirmation() {
    set("ready", true)
    batch("RUNNING", notice("STOP_CANDIDATE_ANNOUNCED"), candidate = true)
    val player = get("chime") as MediaPlayer
    batch("AUTO_STOP", notice("AUTO_STOP_CONFIRMED"))
    assertSame(player, get("chime"))
    shadowOf(player).invokeCompletionListener()
    assertEquals("AUTO_STOP_CONFIRMED", (get("currentNotice") as JSONObject).optString("type"))
    assertTrue(get("chimeActive") as Boolean)
  }

  @Test fun obsoleteGoalWarningIsRemovedAndCannotReturnAfterGoalChange() {
    batch("RUNNING")
    set("goalRevision", "a"); set("goalRevisionIndex", 0)
    val warning=notice("GOAL_WARNING").apply {getJSONObject("data").put("goalRevision","a")}
    batch("RUNNING", warning)
    assertEquals(1,queue().size)
    val payload=JSONObject().put("runId","r").put("state","RUNNING").put("goalRevision","b").put("goalRevisionIndex",1).put("notices",JSONArray())
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,payload.toString())
    assertTrue(queue().isEmpty())
    batch("RUNNING",notice("GOAL_WARNING","old-again").apply{getJSONObject("data").put("goalRevision","a")})
    assertTrue(queue().isEmpty())
  }
  @Test fun lateEndedRunBatchCannotRestartItsClock() {
    batch("RUNNING",notice("RUN_GOAL_FINISHED"),ended=true)
    val prefs=service.getSharedPreferences(RunAnnouncerService.PREFS,Context.MODE_PRIVATE)
    prefs.edit().putBoolean("clockEnabled",false).commit()
    val payload=JSONObject().put("runId","r").put("notices",JSONArray()).put("clock",JSONObject().put("enabled",true).put("minutes",5).put("startedAt",System.currentTimeMillis()))
    service.javaClass.getDeclaredMethod("receiveBatch",String::class.java).apply{isAccessible=true}.invoke(service,payload.toString())
    assertFalse(prefs.getBoolean("clockEnabled",false))
  }
  @Test fun startNoticeIsDeduplicatedEvenAcrossRepeatedBatches() {
    batch("RUNNING",notice("RUN_STARTED","start"));batch("RUNNING",notice("RUN_STARTED","start"))
    assertEquals(1,queue().count{it.optString("type")=="RUN_STARTED"})
    batch("RUNNING",notice("RUN_GOAL_FINISHED"),ended=true)
    assertFalse(queue().any{it.optString("type")=="RUN_STARTED"})
  }
  @Test fun hundredMinuteInformationQueueKeepsAcceptingAndCompletingEvents() {
    var count = 0
    for (minute in 1..100) {
      org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMinutes(1))
      set("ready", false)
      val notices = mutableListOf(notice("PACE_WARNING", "long-pace-$minute"))
      if (minute % 5 == 0) notices.add(notice("FIVE_MINUTES", "long-five-$minute"))
      if (minute % 6 == 0) notices.add(notice("KILOMETER_LAP", "long-km-$minute"))
      batch("RUNNING", *notices.toTypedArray())
      set("ready", true)
      service.javaClass.getDeclaredMethod("speakNext").apply { isAccessible = true }.invoke(service)
      while (get("currentNotice") != null) {
        count++
        (get("chime") as? MediaPlayer)?.let { shadowOf(it).invokeCompletionListener() }
        service.javaClass.getDeclaredMethod("finishUtterance", String::class.java).apply { isAccessible = true }.invoke(service, "DONE")
      }
      assertTrue(queue().isEmpty())
    }
    assertEquals(136, count)
  }
}
