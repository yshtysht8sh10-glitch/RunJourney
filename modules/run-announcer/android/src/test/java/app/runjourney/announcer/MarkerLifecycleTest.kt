package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MarkerLifecycleTest {
  private fun exercise(replaced: Boolean) {
    val service = Robolectric.buildService(RunMarkerService::class.java).create().get()
    fun set(name: String, value: Any) { RunMarkerService::class.java.getDeclaredField(name).apply { isAccessible = true }.set(service, value) }
    fun get(name: String): Any? = RunMarkerService::class.java.getDeclaredField(name).apply { isAccessible = true }.get(service)
    try {
      set("recording", "old"); set("activeToken", if (replaced) "new" else "old")
      set("state", "RECORDING"); set("ready", true); set("count", 7)
      service.onDestroy()
      assertEquals(7, get("count"))
      assertEquals(if (replaced) "RECORDING" else "INTERRUPTED", get("state"))
      assertEquals(replaced, get("ready")); assertEquals(replaced, get("alive"))
    } finally { set("activeToken", ""); set("state", "OFF"); set("ready", false); set("alive", false); set("count", 0) }
  }
  @Test fun lateOldServiceDestructionCannotCancelNewSession() = exercise(true)
  @Test fun currentServiceLossIsInterruptedAndDoesNotPretendToSeal() = exercise(false)
}
