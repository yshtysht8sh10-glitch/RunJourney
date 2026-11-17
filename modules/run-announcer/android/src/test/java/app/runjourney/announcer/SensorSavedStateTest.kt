package app.runjourney.announcer

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SensorSavedStateTest {
  private fun summary() = JSONObject().put("state", "SEALED").put("displayState", "STOPPED")
    .put("accel", JSONObject().put("count", 125)).put("accelReceiptElapsedMs", 1900)
    .put("gyroReceiptElapsedMs", 1800).put("clock", JSONObject().put("wallMs", 102000).put("elapsedBeforeNs", "2000000000"))
  @Test fun restorePreservesCountsAndDoesNotPresentLiveRecording() {
    val s = SensorSavedState.decode("SEALED", summary().toString())!!
    val copy = SensorSavedState.snapshot(s, 3000, 103000)
    assertEquals(125, copy.getJSONObject("accel").getInt("count"))
    assertEquals("STOPPED", copy.getString("displayState"))
    assertEquals(1100L, copy.getLong("accelLastReceivedAgoMs"))
    assertTrue(copy.getBoolean("restoredSummary")); assertFalse(s.has("restoredSummary"))
  }
  @Test fun rebootDoesNotInventAnElapsedAge() {
    val copy = SensorSavedState.snapshot(summary(), 100, 300000)
    assertTrue(copy.isNull("accelLastReceivedAgoMs")); assertTrue(copy.isNull("gyroLastReceivedAgoMs"))
    assertEquals(125, copy.getJSONObject("accel").getInt("count"))
  }
  @Test fun malformedOrActiveSummariesNeverRestoreAsSuccessfulAcquisition() {
    assertNull(SensorSavedState.decode("SEALED", "bad"))
    assertNull(SensorSavedState.decode("ARMED", summary().toString()))
    assertNull(SensorSavedState.decode("INCOMPLETE", summary().toString()))
    val failed = summary().put("state", "INCOMPLETE").put("displayState", "FAILED")
    assertEquals("FAILED", SensorSavedState.decode("INCOMPLETE", failed.toString())!!.getString("displayState"))
  }
}
