package app.runjourney.announcer

/** Test sidecar speech only. No detector, sensor-value or RUN persistence inputs. */
internal object DiagnosticFeedbackPolicy {
  const val TYPE = "TEST_DIAGNOSTIC_FEEDBACK"
  const val PRIORITY = 25 // Below clock/laps/transitions, above pace; never initiates preemption.
  const val LIMIT = 32
  fun message(kind: String) = when (kind) {
    "SENSOR_STARTED" -> "センサー記録を開始しました"
    "BEGIN_SAVED" -> "マーカー開始"
    "END_SAVED" -> "マーカー終了"
    "MARKER_FAILED" -> "マーカーを記録できません"
    "SENSOR_STOPPED" -> "センサー記録が停止しました"
    else -> ""
  }
  fun savedKind(label: String, ackPersisted: Boolean) = if (!ackPersisted) "" else when(label) {
    "BEGIN" -> "BEGIN_SAVED"; "END" -> "END_SAVED"; else -> ""
  }
  fun rejectedPress(mediaDecision: String) = mediaDecision == "ACCEPTED"
  fun valid(run: String, session: String, currentRun: String, currentSession: String, finishedRun: String) =
    run.isNotBlank() && session.isNotBlank() && run == currentRun && session == currentSession && run != finishedRun
  fun retryInterrupted(attempt: Int, valid: Boolean) = valid && attempt < 2
}
