package app.runjourney.announcer

/** Bound engine waiting separately from playback. Long Japanese summaries exceed 3s on Xperia. */
internal object SynthesisBudget {
  fun timeoutMs(message: String): Long = (message.length.toLong() * 60L).coerceIn(3000L, 8000L)
}
