package app.runjourney.announcer

import kotlin.math.*

/** Relative digital level, NOT calibrated dB SPL. Never changes device volume. */
internal class NoiseGain {
  var gain = 0.65f; private set
  var baselineDb = -90.0; private set
  var calibrated = false; private set
  private val calibration = mutableListOf<Double>()
  private var noisy = false
  fun update(db: Double, dtSeconds: Double = .2, hold: Boolean = false): Float {
    if (!db.isFinite() || hold) return gain
    val level = db.coerceIn(-90.0, 0.0)
    if (!calibrated) {
      calibration.add(level)
      if (calibration.size >= 10) { baselineDb = calibration.sorted()[2]; calibrated = true; calibration.clear() }
      return gain
    }
    if (!noisy && level >= baselineDb + 6 && level > -60) noisy = true
    if (noisy && level <= baselineDb + 3) noisy = false
    if (!noisy) baselineDb += (level - baselineDb) * (1 - exp(-dtSeconds / 30))
    val target = if (noisy) 1f else .65f
    val tau = if (target > gain) .4 else 3.0
    gain = (gain + (target - gain) * (1 - exp(-dtSeconds.coerceIn(.01, 1.0) / tau))).toFloat().coerceIn(.65f, 1f)
    return gain
  }
  companion object {
    fun dbfs(samples: ShortArray, count: Int): Double {
      if (count <= 0) return -90.0
      var square = 0.0
      for (i in 0 until count.coerceAtMost(samples.size)) square += samples[i].toDouble().pow(2)
      return (20 * log10(max(1.0, sqrt(square / count)) / 32768)).coerceAtLeast(-90.0)
    }
  }
}
