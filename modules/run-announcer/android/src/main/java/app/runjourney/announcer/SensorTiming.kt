package app.runjourney.announcer

import org.json.JSONObject

/** Event clock and callback clock are deliberately distinct. No detector decisions. */
internal class SensorTiming {
  var count = 0L; private set
  var reversals = 0L; private set
  var gaps = 0L; private set
  var estimatedMissing = 0L; private set
  private var first = 0L
  private var last = 0L
  private var maxGap = 0L
  private var maxDelivery = 0L
  private val histogram = LongArray(2001)
  fun observe(event: Long, received: Long) {
    if (count == 0L) first = event
    if (count > 0) {
      val delta = event - last
      if (delta <= 0) reversals++ else {
        histogram[(delta / 1_000_000).coerceAtMost(2000).toInt()]++
        maxGap = maxOf(maxGap, delta)
        if (delta > 80_000_000) { gaps++; estimatedMissing += ((delta / 40_000_000) - 1).coerceAtLeast(0) }
      }
    }
    maxDelivery = maxOf(maxDelivery, received - event)
    last = event; count++
  }
  fun json(): JSONObject {
    val total = histogram.sum()
    fun percentile(q: Double): Any {
      if (total == 0L) return JSONObject.NULL
      val target = kotlin.math.ceil(total * q).toLong(); var sum = 0L
      for (i in histogram.indices) { sum += histogram[i]; if (sum >= target) return i }
      return JSONObject.NULL
    }
    return JSONObject().put("count", count).put("actualHz", if (last > first) (count - 1) * 1e9 / (last - first) else JSONObject.NULL)
      .put("intervalP50Ms", percentile(.5)).put("intervalP95Ms", percentile(.95)).put("histogramBinMs", 1)
      .put("maxGapMs", maxGap / 1e6).put("gapOver80ms", gaps).put("timestampReversals", reversals)
      .put("estimatedMissingNotExact", estimatedMissing).put("maxCallbackLagMs", maxDelivery / 1e6)
  }
}
