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

class RunAnnouncerService : Service(), TextToSpeech.OnInitListener {
  companion object {
    const val ACTION_START = "app.runjourney.announcer.START"
    const val ACTION_TEST = "app.runjourney.announcer.TEST"
    const val ACTION_WORKOUT = "app.runjourney.announcer.WORKOUT"
    const val PREFS = "runjourney-announcer"
    private const val CHANNEL = "runjourney-voice"
    private const val TAG = "RunAnnouncer"
  }

  private val handler = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ready = false
  private var speaking = false
  private var lastSpeechAt = 0L
  private var pendingWorkout: Pair<String, Long>? = null
  private val messages = java.util.ArrayDeque<String>()
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
      val confirmed = preferences.getLong("confirmedActiveMs", -1)
      val verified = confirmed >= 0
      val announcementTime = if (verified) minOf(active, confirmed) else (active - 10_000).coerceAtLeast(0)
      val due = (announcementTime / interval).toInt()
      val last = preferences.getInt("lastAnnouncement", 0)
      // Never substitute a latest-distance payload for an undelivered lap.
      // OFF and ON both wait for the shared analysis at the exact boundary.
      if (due > last && ready && preferences.getInt("messageInterval", -1) == due) {
        preferences.edit().putInt("lastAnnouncement", due).apply()
        speak(preferences.getString("message", "") ?: "")
      }
      val next = now + ((due.toLong() + 1) * interval + 10_000 - active)
      handler.postDelayed(this, if (verified) 1_000 else (next - now).coerceIn(1_000, 10_000))
    }
  }

  override fun onCreate() {
    super.onCreate()
    val channel = NotificationChannel(CHANNEL, "ランニング音声通知", NotificationManager.IMPORTANCE_LOW)
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    tts = TextToSpeech(this, this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val workout = intent?.action == ACTION_WORKOUT
    val testing = intent?.action == ACTION_TEST || workout
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
      .setContentText("走行中の時間・距離・ペースを案内します")
      .setOngoing(true).build()
    startForeground(607, notification)
    // Workout-only speech also needs a bounded wake lock while the screen is off.
    // A periodic START upgrades any previous temporary lock to the running lock.
    if (wakeLock?.isHeld != true || intent?.action == ACTION_START) {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RunJourney:VoiceAnnouncements")
        .apply { if (preferences.getBoolean("running", false)) acquire() else acquire(30_000) }
    }
    if (testing) {
      val message = intent?.getStringExtra("message") ?: ""
      if (workout) {
        pendingWorkout = message to (intent?.getLongExtra("expiresAt", 0) ?: 0)
        if (ready) deliverWorkout()
      } else {
        // Stops/transitions and periodic laps take priority over guidance.
        pendingWorkout = null
        if (ready) speak(message) else pendingTests.add(message)
      }
      if (!preferences.getBoolean("running", false)) return START_NOT_STICKY
    }
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_STICKY
  }

  override fun onInit(status: Int) {
    ready = status == TextToSpeech.SUCCESS
    if (ready) {
      tts?.language = Locale.JAPANESE
      pendingTests.forEach { speak(it) }
      pendingTests.clear()
      deliverWorkout()
    }
    else {
      Log.e(TAG, "Japanese TTS initialization failed: $status")
      preferences.edit().putString("ttsStatus", "INIT_FAILED").apply()
      finishTest()
    }
  }

  private fun speak(message: String) {
    if (message.isBlank()) return
    pendingWorkout = null
    messages.add(message)
    speakNext()
  }

  private fun deliverWorkout() {
    val pending = pendingWorkout ?: return
    pendingWorkout = null
    val now = System.currentTimeMillis()
    val interval = preferences.getLong("intervalMs", 300_000).coerceAtLeast(1_000)
    val active = preferences.getLong("activeMs", 0) +
      if (preferences.getBoolean("paused", false)) 0 else (now - preferences.getLong("clockUpdatedMs", now)).coerceAtLeast(0)
    val lapDueSoon = preferences.getBoolean("running", false) &&
      (interval - active % interval <= 20_000 || active / interval > preferences.getInt("lastAnnouncement", 0))
    if (preferences.getBoolean("workoutAllowed", false) && now <= pending.second &&
      !speaking && messages.isEmpty() && !lapDueSoon && now - lastSpeechAt >= 20_000) speak(pending.first)
    else if (!speaking && messages.isEmpty()) finishTest()
  }

  private fun speakNext() {
    if (speaking || !ready || messages.isEmpty()) return
    val message = messages.removeFirst()
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(attributes).setOnAudioFocusChangeListener { }.build()
    if (audioManager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      Log.w(TAG, "Audio focus denied")
      preferences.edit().putString("ttsStatus", "AUDIO_FOCUS_DENIED").apply()
      if (!messages.isEmpty()) handler.post { speakNext() } else finishTest()
      return
    }
    focusRequest = request
    speaking = true
    lastSpeechAt = System.currentTimeMillis()
    tts?.setAudioAttributes(attributes)
    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {
        Log.i(TAG, "Speaking: $message")
        preferences.edit().putString("ttsStatus", "SPEAKING").putLong("ttsStartedAt", System.currentTimeMillis()).apply()
      }
      override fun onDone(utteranceId: String?) { handler.post { finishUtterance("DONE") } }
      override fun onError(utteranceId: String?) { handler.post { finishUtterance("ERROR") } }
    })
    if (tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "runjourney-${System.nanoTime()}") != TextToSpeech.SUCCESS) finishUtterance("SPEAK_FAILED")
  }

  private fun finishUtterance(status: String) {
    lastSpeechAt = System.currentTimeMillis()
    preferences.edit().putString("ttsStatus", status).apply()
    releaseFocus()
    speaking = false
    if (messages.isEmpty()) finishTest() else speakNext()
  }

  private fun releaseFocus() {
    focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    focusRequest = null
  }

  private val pendingTests = mutableListOf<String>()

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
