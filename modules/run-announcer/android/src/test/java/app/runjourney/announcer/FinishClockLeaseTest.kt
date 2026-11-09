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
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class FinishClockLeaseTest {
 @Test fun diagnosticClockIsBoundedButRealClockKeepsExistingLifetime() {
  val s=Robolectric.buildService(FinishClockService::class.java).create().get()
  var pulses=0;FinishClockService.pulse={pulses++}
  try {
   s.onStartCommand(Intent().putExtra("previewMs",30000L),0,1)
   shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(31000))
   assertTrue("lease did not stop; pulses=$pulses",shadowOf(s).isStoppedBySelf);assertTrue("too few pulses: $pulses",pulses>=29)
  }finally{s.onDestroy();FinishClockService.pulse=null}
  val real=Robolectric.buildService(FinishClockService::class.java).create().get()
  try{real.onStartCommand(Intent(),0,1);shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(31000));assertFalse(shadowOf(real).isStoppedBySelf)}finally{real.onDestroy()}
 }
}
