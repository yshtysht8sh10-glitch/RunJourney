package app.runjourney.announcer
import android.content.Intent
import android.os.Looper
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class NoiseLeaseTest {
  @Test fun newRunDuringFinishLeaseRenewsCaptureInsteadOfOldExpiryStoppingIt() {
    val service=Robolectric.buildService(NoiseMonitorService::class.java).create().get()
    fun set(name:String,value:Any){service.javaClass.getDeclaredField(name).apply{isAccessible=true}.set(service,value)}
    set("worker",Thread());set("capture",true);set("runId","old")
    NoiseState.measurementRunId="old";NoiseState.validMeasurementMs=1000
    service.onStartCommand(Intent().setAction("FINISH"),0,1)
    service.onStartCommand(Intent().putExtra("runId","new").putExtra("leaseMs",50000L),0,2)
    assertEquals("new",NoiseState.measurementRunId);assertEquals(0L,NoiseState.validMeasurementMs)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(40001))
    assertFalse(shadowOf(service).isStoppedBySelf)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(10000))
    assertTrue(shadowOf(service).isStoppedBySelf)
    service.onDestroy()
  }
}
