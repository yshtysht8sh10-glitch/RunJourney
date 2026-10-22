package app.runjourney.announcer
import org.junit.Assert.assertEquals
import org.junit.Test
class VoicePolicyTest {
  private fun reason(type: String, now: Long = 100, expiry: Long = 120, paused: Boolean = false,
    higher: Boolean = false, pending: Boolean = false, size: Int = 0, empty: Boolean = false) =
    VoicePolicy.suppression(type, empty, now, expiry, paused, higher, pending, size)
  @Test fun transitionsAndLapsTakePriority() {
    assertEquals("HIGHER_PRIORITY_BATCH", reason("PACE_WARNING", higher = true))
    assertEquals("LAP_OR_TRANSITION_PENDING", reason("FIVE_MINUTES", pending = true))
    assertEquals("QUEUED", reason("AUTO_STOP_CONFIRMED", pending = true))
    assertEquals("QUEUED", reason("KILOMETER_LAP", pending = true))
  }
  @Test fun expiryPauseAndQueueLimitAreExplicit() {
    assertEquals("EXPIRED", reason("STOP_CANDIDATE_ANNOUNCED", now = 121))
    assertEquals("PAUSED", reason("PACE_WARNING", paused = true))
    assertEquals("QUEUE_LIMIT", reason("AUTO_RESUME_CONFIRMED", size = 16))
    assertEquals("OBSERVATION_ONLY", reason("STOP_CANDIDATE_CANCELLED", empty = true))
  }
  @Test fun logsBoundByCountAndUtf8Bytes() {
    assertEquals(88, VoicePolicy.retainedStart(List(600) { 10 }))
    assertEquals(1, VoicePolicy.retainedStart(listOf(700000, 700000)))
    assertEquals(1, VoicePolicy.retainedStart(listOf(1048577)))
    assertEquals(0, VoicePolicy.retainedStart(emptyList()))
  }
}
