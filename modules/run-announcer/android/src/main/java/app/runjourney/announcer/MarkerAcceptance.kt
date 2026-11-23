package app.runjourney.announcer

internal object MarkerAcceptance {
  fun reason(state: String, activationReady: Boolean, protocol: Boolean, actualSamplesReady: Boolean, saved: Int): String = when {
    state != "RECORDING" -> "MARKER_NOT_RECORDING"
    !activationReady -> "ACTIVATION_NOT_READY"
    protocol && !actualSamplesReady -> "SENSOR_NOT_RECORDING"
    protocol && saved >= 20 -> "PROTOCOL_COMPLETE"
    else -> "ACCEPTING"
  }
}
