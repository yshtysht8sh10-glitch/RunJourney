package app.runjourney.announcer

import android.content.Context
import android.speech.tts.TextToSpeech
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class DiagnosticVoiceQueueTest {
  private lateinit var service: RunAnnouncerService
  private fun set(name: String, value: Any?) { service.javaClass.getDeclaredField(name).apply { isAccessible=true }.set(service,value) }
  private fun get(name: String) = service.javaClass.getDeclaredField(name).apply { isAccessible=true }.get(service)
  private fun sensor(name: String, value: String) { SensorDiagnostics.javaClass.getDeclaredField(name).apply { isAccessible=true }.set(SensorDiagnostics,value) }
  @Suppress("UNCHECKED_CAST") private fun queue() = get("messages") as MutableList<JSONObject>
  private fun call(name: String, text: String) = service.javaClass.getDeclaredMethod(name,String::class.java).apply { isAccessible=true }.invoke(service,text)
  private fun feedback(id: String, kind: String = "BEGIN_SAVED") = JSONObject().put("id",id).put("type",DiagnosticFeedbackPolicy.TYPE)
    .put("message",DiagnosticFeedbackPolicy.message(kind)).put("expiresAt",1)
    .put("data",JSONObject().put("runId","r").put("sensorSessionId","s").put("feedbackKind",kind).put("ackPersisted",true))
  private fun batch(vararg items: JSONObject, ended: Boolean = false) = call("receiveBatch",JSONObject().put("runId","r").put("state","AUTO_STOP")
    .put("ended",ended).put("latestEventIndex",1).put("notices",JSONArray(items.toList())).toString())
  @Before fun setup() {
    service=Robolectric.buildService(RunAnnouncerService::class.java).create().get()
    val base = service.baseContext
    android.content.ContextWrapper::class.java.getDeclaredField("mBase").apply { isAccessible=true }.set(service,
      object : android.content.ContextWrapper(base) { override fun getPackageName() = "app.runjourney.mobile.test" })
    service.getSharedPreferences("runjourney-voice-debug",Context.MODE_PRIVATE).edit().clear().commit()
    sensor("runId","r");sensor("session","s");set("ready",false)
  }
  @After fun teardown() { service.onDestroy();sensor("runId","");sensor("session","") }
  @Test fun noAckCannotQueueAndDuplicatesOnlyProduceOneNotice() {
    val invalid=feedback("bad");invalid.getJSONObject("data").put("ackPersisted",false)
    call("receiveDiagnosticFeedback",invalid.toString());assertTrue(queue().isEmpty())
    val first=feedback("p1");call("receiveDiagnosticFeedback",first.toString());call("receiveDiagnosticFeedback",first.toString())
    assertEquals(1,queue().size);assertEquals(Long.MAX_VALUE,queue().single().getLong("expiresAt"))
    call("receiveDiagnosticFeedback",feedback("p2","END_SAVED").toString())
    assertEquals(listOf("マーカー開始","マーカー終了"),queue().map { it.getString("message") })
  }
  @Test fun feedbackDoesNotInterruptExistingSpeechAndSecondPressWaitsInOrder() {
    val original=JSONObject().put("type","RUN_STARTED").put("priority",110)
    set("speaking",true);set("currentNotice",original)
    call("receiveDiagnosticFeedback",feedback("begin").toString());call("receiveDiagnosticFeedback",feedback("end","END_SAVED").toString())
    assertSame(original,get("currentNotice"));assertTrue(get("speaking") as Boolean)
    set("ready",true);call("finishUtterance","DONE")
    assertEquals("マーカー開始",(get("currentNotice") as JSONObject).getString("message"))
    call("finishUtterance","DONE")
    assertEquals("マーカー終了",(get("currentNotice") as JSONObject).getString("message"))
  }
  @Test fun stateTransitionCanPreemptButFeedbackRetriesWithoutCreatingNewIdentity() {
    val first=feedback("begin").put("priority",DiagnosticFeedbackPolicy.PRIORITY).put("expiresAt",Long.MAX_VALUE)
    set("speaking",true);set("currentNotice",first)
    val stop=JSONObject().put("id","stop").put("type","AUTO_STOP_CONFIRMED").put("priority",100).put("message","stop")
      .put("expiresAt",System.currentTimeMillis()+30000).put("data",JSONObject().put("runId","r").put("eventIndex",1))
    batch(stop)
    val retry=queue().single { it.optString("id")=="begin" }
    assertEquals(1,retry.getInt("diagnosticAttempt"))
    set("ready",true)
    service.javaClass.getDeclaredMethod("speakNext").apply { isAccessible=true }.invoke(service)
    assertEquals("stop",(get("currentNotice") as JSONObject).getString("id"))
  }
  @Test fun endedRunCancelsQueuedFeedbackAndCannotReappear() {
    call("receiveDiagnosticFeedback",feedback("p1").toString());batch(ended=true)
    assertTrue(queue().isEmpty())
    call("receiveDiagnosticFeedback",feedback("p2").toString());assertTrue(queue().isEmpty())
  }
  @Test fun repeatedFailureWarningsCoalesceButSensorFailureRemainsDistinct() {
    call("receiveDiagnosticFeedback",feedback("stop","SENSOR_STOPPED").toString())
    repeat(5) { call("receiveDiagnosticFeedback",feedback("reject$it","MARKER_FAILED").toString()) }
    assertEquals(2,queue().size)
    assertEquals(listOf("センサー記録が停止しました","マーカーを記録できません"),queue().map { it.optString("message") })
  }
  @Test fun diagnosticSpeechAloneDoesNotCauseScheduledClockToBeSkipped() {
    set("ready",true);set("speaking",true);set("currentNotice",feedback("begin"))
    set("batchRunId","r");set("batchState","RUNNING")
    service.getSharedPreferences(RunAnnouncerService.PREFS,Context.MODE_PRIVATE).edit()
      .putBoolean("clockEnabled",true).putLong("clockStarted",System.currentTimeMillis()-600000)
      .putInt("clockMinutes",10).putLong("clockBoundary",0).commit()
    (get("clockTick") as Runnable).run()
    assertTrue(queue().any { it.optString("type")=="CURRENT_TIME" })
    call("receiveDiagnosticFeedback",feedback("next","END_SAVED").toString())
    call("finishUtterance","DONE")
    assertEquals("CURRENT_TIME",(get("currentNotice") as JSONObject).getString("type"))
  }
  @Test fun feedbackHasSeparateBoundAndDoesNotConsumeOrdinaryQueueAllowance() {
    repeat(40) { call("receiveDiagnosticFeedback",feedback("p$it").toString()) }
    assertEquals(32,queue().size)
    val ordinary=JSONObject().put("id","lap").put("type","KILOMETER_LAP").put("priority",70).put("message","lap")
      .put("expiresAt",System.currentTimeMillis()+30000).put("data",JSONObject().put("runId","r"))
    batch(ordinary);assertTrue(queue().any { it.optString("id")=="lap" })
  }
  @Test fun ttsFailureDoesNotModifySavedMarkerMetadataOrRetryCompletedIdentity() {
    val n=feedback("saved").put("priority",76);val metadata=n.getJSONObject("data").toString()
    set("currentNotice",n);set("speaking",true);call("finishUtterance","ERROR")
    assertEquals(metadata,n.getJSONObject("data").toString());assertTrue(queue().isEmpty())
    call("receiveDiagnosticFeedback",feedback("next","MARKER_FAILED").toString())
    service.onInit(TextToSpeech.ERROR);assertTrue(queue().isEmpty())
  }
}
