package app.runjourney.announcer

internal object MarkerAcknowledgement {
  /** Both durable writes must return before the caller can publish success. */
  fun persist(marker: () -> Unit, ack: () -> Unit, saved: () -> Unit) {
    marker()
    ack()
    saved()
  }
}
