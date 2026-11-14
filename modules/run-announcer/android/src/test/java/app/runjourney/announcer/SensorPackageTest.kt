package app.runjourney.announcer

import android.content.ContextWrapper
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SensorPackageTest {
  @Test fun nonTestPackagesCannotArmOrCollect() {
    for (name in listOf("app.runjourney.mobile", "app.runjourney.mobile.pace", "app.runjourney.mobile.debug")) {
      val c = object : ContextWrapper(RuntimeEnvironment.getApplication()) { override fun getPackageName() = name }
      assertFalse(SensorDiagnostics.control(c, "arm", "POCKET"))
      assertFalse(SensorDiagnostics.control(c, "bench", ""))
      assertTrue(SensorDiagnostics.stats(c).contains("UNAVAILABLE"))
    }
  }
}
