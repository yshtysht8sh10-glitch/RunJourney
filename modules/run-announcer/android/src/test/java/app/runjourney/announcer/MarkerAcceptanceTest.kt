package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test

class MarkerAcceptanceTest {
  @Test fun runningMarkerServiceDoesNotImplyProtocolAcceptance() {
    assertEquals("SENSOR_NOT_RECORDING", MarkerAcceptance.reason("RECORDING", true, true, false, 0))
    assertEquals("ACTIVATION_NOT_READY", MarkerAcceptance.reason("RECORDING", false, true, true, 0))
    assertEquals("MARKER_NOT_RECORDING", MarkerAcceptance.reason("CLOSING", true, true, true, 0))
  }
  @Test fun failureOrCompletionCannotAdvanceLabels() {
    assertEquals("ACCEPTING", MarkerAcceptance.reason("RECORDING", true, true, true, 19))
    assertEquals("PROTOCOL_COMPLETE", MarkerAcceptance.reason("RECORDING", true, true, true, 20))
    assertEquals("SENSOR_NOT_RECORDING", MarkerAcceptance.reason("RECORDING", true, true, false, 10))
  }
  @Test fun existingFieldAndTrialModesRemainIndependentOfSensors() {
    assertEquals("ACCEPTING", MarkerAcceptance.reason("RECORDING", true, false, false, 100))
  }
}
