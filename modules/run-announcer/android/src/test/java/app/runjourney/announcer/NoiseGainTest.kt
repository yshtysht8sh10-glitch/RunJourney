package app.runjourney.announcer
import org.junit.Assert.*
import org.junit.Test

class NoiseGainTest {
  @Test fun quietNoiseQuietTracksSmoothlyWithinDeviceCeiling() {
    val policy = NoiseGain()
    repeat(10) { policy.update(-50.0) }
    assertTrue(policy.calibrated); assertEquals(.65f, policy.gain, .001f)
    val first = policy.update(-30.0)
    assertTrue(first > .65f && first < 1f)
    repeat(20) { policy.update(-30.0) }
    assertTrue(policy.gain > .99f && policy.gain <= 1f)
    val released = policy.update(-50.0)
    assertTrue(released > .65f && released < 1f)
    repeat(100) { policy.update(-50.0) }
    assertEquals(.65f, policy.gain, .001f)
  }
  @Test fun ownSpeakerAudioAndInvalidLevelsCannotCauseFeedbackBoost() {
    val policy = NoiseGain(); repeat(10) { policy.update(-50.0) }
    repeat(100) { policy.update(-5.0, hold = true) }
    assertEquals(.65f, policy.gain, .001f)
    policy.update(Double.NaN); assertEquals(.65f, policy.gain, .001f)
  }
  @Test fun sustainedTrafficDoesNotLatchAndSuddenVehicleHasHeadroom() {
    val policy = NoiseGain(); repeat(10) { policy.update(-70.0) }
    repeat(600) { policy.update(-43.0) } // two minutes of unchanging traffic
    assertTrue(policy.gain < .95f && policy.gain > .65f)
    val before = policy.gain
    repeat(10) { policy.update(-23.0) }
    assertTrue(policy.gain > before && policy.gain <= 1f)
    repeat(150) { policy.update(-70.0) }
    assertEquals(.65f, policy.gain, .001f)
  }
  @Test fun mediumNoiseIsProportionalAndInvalidDurationIsBounded() {
    val policy = NoiseGain(); repeat(10) { policy.update(-50.0) }
    repeat(15) { policy.update(-40.0) }
    assertTrue(policy.gain > .7f && policy.gain < .95f)
    policy.update(-10.0, Double.NaN)
    assertTrue(policy.gain.isFinite() && policy.gain <= 1f)
  }
  @Test fun pcmIsReducedToDigitalLevelWithoutAnyStorage() {
    assertEquals(-90.0, NoiseGain.dbfs(ShortArray(3200), 3200), .001)
    assertEquals(-6.02, NoiseGain.dbfs(ShortArray(3200) { 16384 }, 3200), .01)
    assertTrue(NoiseGain.dbfs(ShortArray(3200) { Short.MAX_VALUE }, 3200) <= 0)
  }
}
