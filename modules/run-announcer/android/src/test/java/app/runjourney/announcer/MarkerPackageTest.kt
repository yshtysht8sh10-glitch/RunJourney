package app.runjourney.announcer

import android.content.ComponentName
import android.content.ContextWrapper
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MarkerPackageTest {
  @Test fun productionPaceDebugAndWebCannotStartMarkerService() {
    for (name in listOf("app.runjourney.mobile", "app.runjourney.mobile.pace", "app.runjourney.mobile.debug", "test")) {
      var starts = 0
      val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
        override fun getPackageName() = name
        override fun startForegroundService(intent: Intent): ComponentName { starts++; return ComponentName(name, RunMarkerService::class.java.name) }
      }
      assertFalse(RunMarkerService.control(context, "trial")); assertFalse(RunMarkerService.control(context, "field"))
      assertFalse(RunMarkerService.control(context, "off")); assertEquals(0, starts)
      assertTrue(RunMarkerService.stats(context).contains("UNAVAILABLE"))
    }
  }
}
