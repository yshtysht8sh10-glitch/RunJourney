package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test

class VoiceStateTest {
  private fun valid(type: String, state: String = "RUNNING", cancel: Boolean = false, ended: Boolean = false, index: Int = 1, latest: Int = 1) =
    VoicePolicy.validState(type, cancel, state, ended, index, latest)
  @Test fun repeatedStopsAndResumes() {
    for (index in 1..4) {
      val stopped = index % 2 == 1
      assertTrue(valid(if (stopped) "AUTO_STOP_CONFIRMED" else "AUTO_RESUME_CONFIRMED", if (stopped) "AUTO_STOP" else "RUNNING", index = index, latest = index))
      assertFalse(valid(if (stopped) "AUTO_RESUME_CONFIRMED" else "AUTO_STOP_CONFIRMED", if (stopped) "AUTO_STOP" else "RUNNING", index = index - 1, latest = index))
    }
  }
  @Test fun hintCancelledOnConfirmationOrMovement() {
    assertTrue(valid("STOP_CANDIDATE_ANNOUNCED"))
    assertFalse(valid("STOP_CANDIDATE_ANNOUNCED", state = "AUTO_STOP"))
    assertFalse(valid("STOP_CANDIDATE_ANNOUNCED", cancel = true))
    assertTrue(valid("STOP_CANDIDATE_ANNOUNCED"))
  }
  @Test fun hintPreemptsLongPeriodicAndLapButNeverConfirmedTransition() {
    assertTrue(VoicePolicy.shouldPreempt(40, 80))
    assertTrue(VoicePolicy.shouldPreempt(70, 80))
    assertTrue(VoicePolicy.shouldPreempt(80, 100))
    assertFalse(VoicePolicy.shouldPreempt(100, 80))
    assertTrue(VoicePolicy.shouldPreempt(100, 110))
  }
  @Test fun goalCompletionInvalidatesEveryRunningNotice() {
    for (type in listOf("STOP_CANDIDATE_ANNOUNCED", "AUTO_STOP_CONFIRMED", "AUTO_RESUME_CONFIRMED", "FIVE_MINUTES", "KILOMETER_LAP", "PACE_WARNING", "WORKOUT_GOAL")) assertFalse(valid(type, ended = true))
    assertTrue(valid("RUN_GOAL_FINISHED", ended = true))
  }
  @Test fun deadlinesRemainStrict() {
    assertEquals("EXPIRED", VoicePolicy.suppression("STOP_CANDIDATE_ANNOUNCED", false, 5000, 4000, false, false, false, 0))
    assertEquals("QUEUED", VoicePolicy.suppression("STOP_CANDIDATE_ANNOUNCED", false, 3000, 4000, false, true, true, 0))
  }
}
