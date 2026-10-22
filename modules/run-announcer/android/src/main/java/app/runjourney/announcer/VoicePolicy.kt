package app.runjourney.announcer

/** Android-free policy, also exercised by JVM tests. */
internal object VoicePolicy {
  fun suppression(type: String, empty: Boolean, now: Long, expires: Long, paused: Boolean,
    higherBatch: Boolean, importantPending: Boolean, size: Int): String = when {
    empty -> "OBSERVATION_ONLY"
    now > expires -> "EXPIRED"
    paused && type == "PACE_WARNING" -> "PAUSED"
    type == "PACE_WARNING" && higherBatch -> "HIGHER_PRIORITY_BATCH"
    (type == "FIVE_MINUTES" || type == "PACE_WARNING") && importantPending -> "LAP_OR_TRANSITION_PENDING"
    size >= 16 -> "QUEUE_LIMIT"
    else -> "QUEUED"
  }
}
