package app.runjourney.announcer

/** A removed profile is not proof that the headset has disconnected. */
internal class MarkerRouteMonitor(
  private val post: (Runnable, Long) -> Unit,
  private val remove: (Runnable) -> Unit,
  private val owned: () -> Boolean,
  private val connectedOutput: () -> Boolean,
  private val result: (String) -> Unit,
) {
  private var pending: Runnable? = null
  private var generation = 0
  fun removed(bluetoothOutput: Boolean) {
    if (!bluetoothOutput || !owned()) return
    stop()
    val token = generation
    val task = Runnable {
      if (generation != token || !owned()) return@Runnable
      pending = null
      val reason = try {
        if (connectedOutput()) "BLUETOOTH_OUTPUT_REMAINS" else "HEADSET_ROUTE_REMOVED"
      } catch (_: Exception) { "HEADSET_ROUTE_QUERY_FAILED" }
      result(reason)
    }
    pending = task; post(task, 1000L)
  }
  fun stop() { generation++; pending?.let(remove); pending = null }
}
