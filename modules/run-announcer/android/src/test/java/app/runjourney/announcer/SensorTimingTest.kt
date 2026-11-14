package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SensorTimingTest {
  @Test fun detectsRealRateGapAndReverseWithoutPretendingExactHardwareLoss() {
    val timing = SensorTiming()
    repeat(26) { i -> timing.observe(1_000_000_000 + i * 40_000_000L, 1_010_000_000 + i * 40_000_000L) }
    assertEquals(25.0, timing.json().getDouble("actualHz"), .0001)
    assertEquals(40, timing.json().getInt("intervalP95Ms"))
    timing.observe(2_200_000_000, 2_210_000_000)
    timing.observe(2_190_000_000, 2_220_000_000)
    assertEquals(1, timing.json().getInt("gapOver80ms"))
    assertEquals(1, timing.json().getInt("timestampReversals"))
    assertEquals(4, timing.json().getInt("estimatedMissingNotExact"))
  }
}
