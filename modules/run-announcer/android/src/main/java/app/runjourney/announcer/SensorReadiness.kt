package app.runjourney.announcer

/** Actual receipt gates readiness; successful registration alone cannot establish RECORDING. */
internal class SensorReadiness {
  private val last = mutableMapOf<Int, Long>()
  private val counts = mutableMapOf<Int, Long>()
  fun reset() { last.clear(); counts.clear() }
  fun receive(type: Int, now: Long): Boolean {
    if (type !in listOf(1, 4)) return false
    val first = !last.containsKey(type)
    last[type] = now; counts[type] = (counts[type] ?: 0) + 1
    return first
  }
  fun ready() = listOf(1, 4).all { (counts[it] ?: 0) > 0 }
  fun age(type: Int, now: Long): Long? = last[type]?.let { (now - it).coerceAtLeast(0) }
  fun stale(now: Long) = ready() && listOf(1, 4).any { age(it, now)!! > 10_000 }
}
