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
 @Test fun realRunUpgradesPreviewWakeLockWithoutThirtySecondCutoff() {
  val s=Robolectric.buildService(FinishClockService::class.java).create().get()
  try{
   s.onStartCommand(Intent().putExtra("previewMs",30000L),0,1)
   s.onStartCommand(Intent(),0,2)
   shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(31000))
   val lock=s.javaClass.getDeclaredField("lock").apply{isAccessible=true}.get(s) as android.os.PowerManager.WakeLock
   assertTrue(lock.isHeld);assertFalse(shadowOf(s).isStoppedBySelf)
  }finally{s.onDestroy()}
 }
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
