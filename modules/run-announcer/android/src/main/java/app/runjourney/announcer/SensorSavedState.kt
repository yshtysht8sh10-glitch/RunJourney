package app.runjourney.announcer

import org.json.JSONObject
import kotlin.math.abs

/** Terminal UI aggregates only. A restored summary never establishes live readiness. */
internal object SensorSavedState {
  fun decode(state: String?, text: String?): JSONObject? = try {
    if (state !in listOf("SEALED", "INCOMPLETE", "UNAVAILABLE")) null
    else JSONObject(text ?: "").takeIf { it.optString("state") == state }
  } catch (_: Exception) { null }

  fun snapshot(stored: JSONObject, nowElapsed: Long, nowWall: Long): JSONObject {
    val copy = JSONObject(stored.toString()).put("restoredSummary", true)
    val anchor = stored.optJSONObject("clock")
    val oldElapsed = anchor?.optString("elapsedBeforeNs")?.toLongOrNull()?.div(1e6)
    val sameBoot = anchor != null && oldElapsed != null && abs(
      (anchor.optDouble("wallMs") - oldElapsed) - (nowWall - nowElapsed)) < 10_000
    for ((field, last) in listOf("accelLastReceivedAgoMs" to "accelReceiptElapsedMs", "gyroLastReceivedAgoMs" to "gyroReceiptElapsedMs")) {
      val receipt = stored.optLong(last, 0)
      copy.put(field, if (sameBoot && receipt > 0 && nowElapsed >= receipt) nowElapsed - receipt else JSONObject.NULL)
    }
    return copy
  }
}
