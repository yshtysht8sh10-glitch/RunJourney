package app.runjourney.announcer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/** GPS-independent pulse. JS derives the boundary from the durable active clock.
 * Does not invent fixes or write history from a second database connection.
 */
class FinishClockService : Service() {
  companion object { var pulse: (() -> Unit)? = null }
  private val handler = Handler(Looper.getMainLooper())
  private var lock: PowerManager.WakeLock? = null
  private val tick = object : Runnable {
    override fun run() {
      try { pulse?.invoke() } catch (e: Exception) { android.util.Log.w("RunJourneyClock", "JS pulse unavailable", e) }
      handler.postDelayed(this, 1000)
    }
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channel = "runjourney-finish-clock"
    getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(channel, "走行終了条件", NotificationManager.IMPORTANCE_LOW))
    startForeground(3801, Notification.Builder(this, channel).setContentTitle("RunJourneyでランニングを記録中")
      .setContentText("目標達成時に計測を終了します").setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build())
    if (lock?.isHeld != true) lock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RunJourney:FinishClock").apply { acquire() }
    handler.removeCallbacks(tick); handler.post(tick)
    return START_NOT_STICKY
  }
  override fun onDestroy() { handler.removeCallbacks(tick); lock?.let { if (it.isHeld) it.release() }; super.onDestroy() }
  override fun onBind(intent: Intent?): IBinder? = null
}
