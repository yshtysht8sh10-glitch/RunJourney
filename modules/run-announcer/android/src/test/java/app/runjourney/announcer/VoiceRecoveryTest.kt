package app.runjourney.announcer

import android.content.Context
import android.media.MediaPlayer
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
    ShadowMediaPlayer.setMediaInfoProvider { ShadowMediaPlayer.MediaInfo(320, 0) }
    service = Robolectric.buildService(RunAnnouncerService::class.java).create().get()
    service.getSharedPreferences("runjourney-voice-debug", Context.MODE_PRIVATE).edit().clear().commit()
    set("ready", false)
  }
  @After fun destroy() { service.onDestroy() }
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
      queue().clear(); set("chimeActive", true); set("speaking", true)
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
    assertFalse(get("chimeActive") as Boolean)
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
}
