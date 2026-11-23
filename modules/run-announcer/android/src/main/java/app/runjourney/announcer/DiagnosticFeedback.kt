package app.runjourney.announcer

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import org.json.JSONObject

/** Fire-and-forget speech cannot undo, reject or block marker/sensor storage. */
internal object DiagnosticFeedback {
  fun emit(c: Context, kind: String, id: String, runId: String, session: String, details: JSONObject = JSONObject()) {
    if (c.packageName != "app.runjourney.mobile.test" || runId.isBlank() || session.isBlank()) return
    val message = DiagnosticFeedbackPolicy.message(kind)
    if (message.isBlank()) return
    try {
      val now = System.currentTimeMillis()
      val data = JSONObject(details.toString()).put("runId", runId).put("sensorSessionId", session)
        .put("feedbackKind", kind).put("generatedElapsedMs", SystemClock.elapsedRealtime())
      val n = JSONObject().put("id", "diagnostic:$session:$id").put("type", DiagnosticFeedbackPolicy.TYPE)
        .put("message", message).put("priority", DiagnosticFeedbackPolicy.PRIORITY)
        .put("generatedAt", now).put("expiresAt", Long.MAX_VALUE).put("data", data)
      DiagnosticAudit.record(c, "FEEDBACK_GENERATED", runId, session, JSONObject(n.toString()))
      c.startForegroundService(Intent(c, RunAnnouncerService::class.java)
        .setAction(RunAnnouncerService.ACTION_DIAGNOSTIC_FEEDBACK).putExtra("payload", n.toString()))
    } catch (e: Exception) {
      DiagnosticAudit.record(c, "FEEDBACK_DELIVERY_FAILED", runId, session, JSONObject().put("feedbackKind", kind).put("reason", e.javaClass.simpleName))
    }
  }
}
