package app.runjourney.announcer

import org.json.JSONObject

/** Called before touching the common queue. A late old-purpose packet cannot
 * cancel or replace the current purpose's audio context. Legacy binaries had no owner file.
 */
internal object MeasurementVoiceBinding {
  fun accepts(owner: JSONObject, runId: String, ended: Boolean): Boolean {
    if(owner.isNull("binding")) return true
    val binding = owner.getJSONObject("binding")
    val id = binding.getString("sessionId")
    val expected = when(binding.getString("purpose")) {
      "running" -> id; "cycling" -> "cycling:$id"; else -> return false
    }
    return runId == expected && (binding.getString("status") == "ACTIVE" || ended && binding.getString("status") in listOf("STOPPING", "FINISH_FAILED"))
  }
}
