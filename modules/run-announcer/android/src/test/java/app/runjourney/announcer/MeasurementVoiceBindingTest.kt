package app.runjourney.announcer

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class MeasurementVoiceBindingTest {
  private fun owner(kind: String, status: String = "ACTIVE") = JSONObject().put("binding", JSONObject()
    .put("purpose", kind).put("sessionId", "same-id").put("status", status))
  @Test fun sameRecordIdsCannotCrossSportVoiceContexts() {
    assertTrue(MeasurementVoiceBinding.accepts(owner("running"), "same-id", false))
    assertFalse(MeasurementVoiceBinding.accepts(owner("running"), "cycling:same-id", false))
    assertTrue(MeasurementVoiceBinding.accepts(owner("cycling"), "cycling:same-id", false))
    assertFalse(MeasurementVoiceBinding.accepts(owner("cycling"), "same-id", true))
  }
  @Test fun stoppingAcceptsOnlySameOwnerTerminalCancellationAndGenericAcceptsNoSportVoice() {
    assertFalse(MeasurementVoiceBinding.accepts(owner("cycling", "STOPPING"), "cycling:same-id", false))
    assertTrue(MeasurementVoiceBinding.accepts(owner("cycling", "STOPPING"), "cycling:same-id", true))
    assertFalse(MeasurementVoiceBinding.accepts(owner("generic"), "same-id", false))
  }
}
