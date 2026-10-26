package app.runjourney.announcer

/** Android-free policy, also exercised by JVM tests. */
internal object VoicePolicy {
  fun information(type: String) = type in listOf("FIVE_MINUTES", "KILOMETER_LAP", "PACE_WARNING")
  fun validState(type: String, candidateCancelled: Boolean, state: String, ended: Boolean, eventIndex: Int, latestEventIndex: Int): Boolean = when {
    ended -> type == "RUN_GOAL_FINISHED"
    type == "STOP_CANDIDATE_ANNOUNCED" -> !candidateCancelled && state == "RUNNING"
    type == "PACE_WARNING" -> true
    type in listOf("AUTO_STOP_CONFIRMED", "AUTO_RESUME_CONFIRMED", "BREAK", "RESUME") ->
      (latestEventIndex < 0 || eventIndex == latestEventIndex) && when(type) {
        "AUTO_STOP_CONFIRMED" -> state == "AUTO_STOP"; "BREAK" -> state == "BREAK"; else -> state == "RUNNING"
      }
    else -> true
  }
  fun shouldPreempt(currentPriority: Int, nextPriority: Int) = nextPriority >= 80 && currentPriority < nextPriority
  fun suppression(type: String, empty: Boolean, now: Long, expires: Long, paused: Boolean,
    higherBatch: Boolean, importantPending: Boolean, size: Int): String = when {
    empty -> "OBSERVATION_ONLY"
    now > expires -> "EXPIRED"
    size >= 16 -> "QUEUE_LIMIT"
    else -> "QUEUED"
  }
}
