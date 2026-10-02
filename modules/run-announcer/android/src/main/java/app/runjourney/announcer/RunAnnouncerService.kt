package app.runjourney.announcer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import kotlin.math.roundToInt

class RunAnnouncerService : Service(), TextToSpeech.OnInitListener {
  companion object {
    const val ACTION_START = "app.runjourney.announcer.START"
    const val ACTION_TEST = "app.runjourney.announcer.TEST"
    const val PREFS = "runjourney-announcer"
    private const val CHANNEL = "runjourney-voice"
    private const val TAG = "RunAnnouncer"
  }

  private val handler = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ready = false
  private var wakeLock: PowerManager.WakeLock? = null
  private var focusRequest: AudioFocusRequest? = null
  private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
  private val preferences by lazy { getSharedPreferences(PREFS, 0) }

  private val tick = object : Runnable {
    override fun run() {
      if (!preferences.getBoolean("running", false)) return
      val started = preferences.getLong("startedAtMs", 0)
      val interval = preferences.getLong("intervalMs", 300_000).coerceAtLeast(1_000)
      val now = System.currentTimeMillis()
      // Allow the background location task a short window to publish the lap.
      val active = preferences.getLong("activeMs", (now - started).coerceAtLeast(0)) +
        if (preferences.getBoolean("paused", false)) 0 else (now - preferences.getLong("clockUpdatedMs", now)).coerceAtLeast(0)
      val due = ((active - 10_000).coerceAtLeast(0) / interval).toInt()
      val last = preferences.getInt("lastAnnouncement", 0)
      if (due > last && ready) {
        preferences.edit().putInt("lastAnnouncement", due).apply()
        val minutes = (active / 60_000).toInt()
        val km = (preferences.getFloat("distanceMeters", 0f) / 100f).roundToInt() / 10.0
        val message = if (preferences.getInt("messageInterval", -1) == due)
          preferences.getString("message", null) else null
        speak(message ?: "${minutes}分です。総走行距離${km}キロメートル。")
      }
      val next = now + ((due.toLong() + 1) * interval + 10_000 - active)
      handler.postDelayed(this, (next - now).coerceIn(1_000, 10_000))
    }
  }

  override fun onCreate() {
    super.onCreate()
    val channel = NotificationChannel(CHANNEL, "ランニング音声通知", NotificationManager.IMPORTANCE_LOW)
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    tts = TextToSpeech(this, this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val testing = intent?.action == ACTION_TEST
    if (intent?.action == ACTION_START) {
      val started = intent.getLongExtra("startedAtMs", System.currentTimeMillis())
      val previous = preferences.getLong("startedAtMs", 0)
      preferences.edit().putBoolean("running", true).putLong("startedAtMs", started)
        .putLong("intervalMs", intent.getLongExtra("intervalMs", 300_000))
        .putInt("lastAnnouncement", if (previous == started) preferences.getInt("lastAnnouncement", 0) else 0)
        .putInt("messageInterval", if (previous == started) preferences.getInt("messageInterval", -1) else -1)
        .apply()
    }
    if (!preferences.getBoolean("running", false) && !testing) {
      stopSelf()
      return START_NOT_STICKY
    }
    val notification = Notification.Builder(this, CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("RunJourney 音声通知中")
      .setContentText("走行中、5分ごとに時間と距離を読み上げます")
      .setOngoing(true).build()
    startForeground(607, notification)
    if (testing) {
      val message = intent?.getStringExtra("message") ?: ""
      if (ready) speak(message) else pendingTest = message
      return START_NOT_STICKY
    }
    if (wakeLock?.isHeld != true) {
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RunJourney:VoiceAnnouncements")
        .apply { acquire() }
    }
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_STICKY
  }

  override fun onInit(status: Int) {
    ready = status == TextToSpeech.SUCCESS
    if (ready) {
      tts?.language = Locale.JAPANESE
      pendingTest?.let { speak(it) }
      pendingTest = null
    }
    else Log.e(TAG, "Japanese TTS initialization failed: $status")
  }

  private fun speak(message: String) {
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(attributes).setOnAudioFocusChangeListener { }.build()
    if (audioManager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return
    focusRequest = request
    tts?.setAudioAttributes(attributes)
    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) { Log.i(TAG, "Speaking: $message") }
      override fun onDone(utteranceId: String?) { releaseFocus(); finishTest() }
      override fun onError(utteranceId: String?) { releaseFocus(); finishTest() }
    })
    if (tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "runjourney-update") != TextToSpeech.SUCCESS) releaseFocus()
  }

  private fun releaseFocus() {
    focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    focusRequest = null
  }

  private var pendingTest: String? = null

  private fun finishTest() {
    if (!preferences.getBoolean("running", false)) handler.post { stopSelf() }
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    tts?.stop()
    tts?.shutdown()
    releaseFocus()
    wakeLock?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
