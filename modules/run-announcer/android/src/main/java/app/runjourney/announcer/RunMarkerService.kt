package app.runjourney.announcer

import android.app.*
import android.content.Context
import android.content.Intent
import android.media.*
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.*
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.view.KeyEvent
import app.runjourney.markerprobe.MarkerKeys
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import expo.modules.kotlin.Promise

/** Explicit Test-only sidecar, started/stopped by the user, never by GPS/detector state. */
class RunMarkerService : Service() {
  companion object {
    private const val PACKAGE = "app.runjourney.mobile.test"
    private const val ALIAS = "RunJourney.Test.RunMarkers.v1"
    private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(64))
    @Volatile private var state = "OFF"
    @Volatile private var count = 0
    @Volatile private var mode = ""
    @Volatile private var lastLabel = ""
    @Volatile private var lastAt = 0L
    @Volatile private var failure = ""
    @Volatile private var endReason = ""
    private fun test(c: Context) = c.packageName == PACKAGE
    fun control(c: Context, action: String): Boolean {
      if (!test(c) || action !in listOf("trial", "field", "off")) return false
      if (action != "off" && state in listOf("STARTING", "RECORDING", "CLOSING")) return false
      val intent = Intent(c, RunMarkerService::class.java).putExtra("action", action)
      if (action == "off" && state !in listOf("STARTING", "RECORDING")) return true
      c.startForegroundService(intent); return true
    }
    fun stats(c: Context): String = if (!test(c)) JSONObject().put("state", "UNAVAILABLE").toString() else JSONObject()
      .put("state", state).put("count", count).put("mode", mode).put("lastLabel", lastLabel)
      .put("lastReceivedAt", lastAt).put("failure", failure).put("endReason", endReason).put("physicalPressTimeMeasured", false).toString()
    private fun key(): SecretKey {
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
      return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setRandomizedEncryptionRequired(true).build())
      }.generateKey()
    }
    fun read(c: Context, promise: Promise) {
      if (!test(c)) { promise.reject("TEST_ONLY", "Test only", null); return }
      try { worker.execute {
        try {
          val name = c.getSharedPreferences("runjourney-markers", 0).getString("last", "") ?: ""
          check(name.matches(Regex("[0-9a-f-]{36}\\.jsonl"))) { "No marker recording" }
          promise.resolve(MarkerLog.read(File(c.noBackupFilesDir, "run-markers-v1/$name"), key()).toString())
        } catch (e: Exception) { promise.reject("MARKER_READ", e.message, e) }
      } } catch (e: Exception) { promise.reject("MARKER_BUSY", e.message, e) }
    }
  }
  private val handler = Handler(Looper.getMainLooper())
  private val keys = MarkerKeys()
  private var session: MediaSession? = null
  private var player: MediaPlayer? = null
  private var lock: PowerManager.WakeLock? = null
  private var log: MarkerLog? = null
  private var recording = ""
  private val routeWatch = object : AudioDeviceCallback() {
    override fun onAudioDevicesRemoved(devices: Array<out AudioDeviceInfo>) {
      if (devices.any { it.type in listOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET) }) close("HEADSET_ROUTE_REMOVED")
    }
  }
  private fun stamp() = JSONObject().put("wall", System.currentTimeMillis()).put("elapsed", SystemClock.elapsedRealtime())
    .put("uptime", SystemClock.uptimeMillis())
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!test(this)) { stopSelf(); return START_NOT_STICKY }
    getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("run-markers", "実停止マーカー（Test）", NotificationManager.IMPORTANCE_LOW))
    startForeground(6073, Notification.Builder(this, "run-markers").setSmallIcon(applicationInfo.icon)
      .setContentTitle("実停止マーカーを記録中")
      .setContentText("ボタン1回で停止/再開を交互に記録。RUNのタイマーは変更しません").setOngoing(true).build())
    if (intent?.getStringExtra("action") == "off") { close("USER_ENDED"); return START_NOT_STICKY }
    if (recording.isNotEmpty()) return START_NOT_STICKY
    mode = intent?.getStringExtra("action") ?: "trial"
    if (mode !in listOf("trial", "field")) { stopSelf(); return START_NOT_STICKY }
    state = "STARTING"; count = 0; lastLabel = ""; lastAt = 0; failure = ""; endReason = ""
    recording = UUID.randomUUID().toString()
    val token = recording
    lock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RunJourney:MarkerPoC")
      .apply { acquire(if (mode == "trial") 910000 else 10810000) }
    try { worker.execute {
      try {
        val root = File(noBackupFilesDir, "run-markers-v1")
        check((root.listFiles()?.sumOf { it.length() } ?: 0) < 10_000_000) { "Marker total capacity" }
        val file = File(root, "$token.jsonl")
        log = MarkerLog(file, key()).also { it.append("START", stamp().put("mode", mode).put("simulation", mode == "trial")
          .put("association", "independent session; match to RUN by time after recording")
          .put("labelSource", "USER_BUTTON_NOT_GPS").put("physicalPressTimeMeasured", false)) }
        getSharedPreferences("runjourney-markers", 0).edit().putString("last", file.name).commit()
        handler.post { if (recording == token && state == "STARTING") { state = "RECORDING"; activate() } }
      } catch (e: Exception) { fail(e) }
    } } catch (e: Exception) { fail(e) }
    handler.postDelayed({ if (recording == token) close(if (mode == "trial") "TRIAL_TIMEOUT" else "LIMIT_3_HOURS") },
      if (mode == "trial") 900000 else 10800000)
    return START_NOT_STICKY
  }
  private fun fail(e: Exception) {
    failure = e.javaClass.simpleName + ":" + (e.message ?: "")
    state = "FAILED"; handler.post { stopSelf() }
  }
  private fun activate() {
    getSystemService(AudioManager::class.java).registerAudioDeviceCallback(routeWatch, handler)
    session = MediaSession(this, "RunJourney-Test-Field-Markers").apply {
      setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
      setCallback(object : MediaSession.Callback() {
        override fun onMediaButtonEvent(intent: Intent): Boolean {
          @Suppress("DEPRECATION") val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
          val relevant = event.keyCode in listOf(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK)
          val decision = keys.admit(relevant, event.action, event.repeatCount, event.deviceId, event.downTime)
          if (decision == "ACCEPTED") marker(stamp().put("source", "KEY").put("keyCode", event.keyCode)
            .put("keyEventTimeAvailable", event.eventTime > 0).put("keyEventUptime", if (event.eventTime > 0) event.eventTime else JSONObject.NULL))
          return relevant
        }
        override fun onPlay() { marker(stamp().put("source", "TRANSPORT_PLAY").put("keyEventTimeAvailable", false)) }
        override fun onPause() { marker(stamp().put("source", "TRANSPORT_PAUSE").put("keyEventTimeAvailable", false)) }
      }, handler)
      setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE)
        .setState(PlaybackState.STATE_PAUSED, 0, 0f).build()); isActive = true
    }
    // A single real activation cue establishes the normal local playback session.
    // No audio focus, silent track or permanent fake PLAYING state.
    try {
      player = MediaPlayer().also { p ->
        p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        resources.openRawResourceFd(R.raw.run_notice).use { fd -> p.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length) }
        fun completed() { if (player === p) { p.release(); player = null; session?.setPlaybackState(PlaybackState.Builder()
          .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE).setState(PlaybackState.STATE_PAUSED, 0, 0f).build()) } }
        p.setOnCompletionListener { completed() }; p.setOnErrorListener { _, _, _ -> completed(); true }
        p.prepare(); p.start()
        session?.setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE)
          .setState(PlaybackState.STATE_PLAYING, 0, 1f).build())
        handler.postDelayed({ completed() }, 2000)
      }
    } catch (e: Exception) { fail(e) }
  }
  private fun marker(data: JSONObject) {
    if (state != "RECORDING") return
    try { worker.execute {
      try {
        val label = if (mode == "trial") "TEST" else if (count % 2 == 0) "STOP" else "RESUME"
        log!!.append("MARKER", data.put("label", label).put("markerIndex", count).put("labelSource", "USER_BUTTON_NOT_GPS"))
        log!!.append("ACK", stamp().put("markerIndex", count).put("receivedElapsed", data.getLong("elapsed")))
        count++; lastLabel = label; lastAt = data.getLong("wall")
        if (mode == "trial" && count == 10) handler.post { close("TRIAL_COMPLETED") }
      } catch (e: Exception) { fail(e) }
    } } catch (e: Exception) { fail(e) }
  }
  private fun close(reason: String) {
    if (state !in listOf("STARTING", "RECORDING")) { stopSelf(); return }
    state = "CLOSING"; endReason = reason; session?.isActive = false
    try { worker.execute {
      try {
        log?.append("END", stamp().put("reason", reason).put("markerCount", count)
          .put("complete", reason in listOf("USER_ENDED", "TRIAL_COMPLETED")))
        state = if (reason in listOf("USER_ENDED", "TRIAL_COMPLETED")) "SEALED" else "INCOMPLETE"
        handler.post { stopSelf() }
      } catch (e: Exception) { fail(e) }
    } } catch (e: Exception) { fail(e) }
  }
  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    session?.isActive = false; session?.release(); session = null
    player?.release(); player = null
    getSystemService(AudioManager::class.java).unregisterAudioDeviceCallback(routeWatch)
    lock?.let { if (it.isHeld) it.release() }
    if (state in listOf("RECORDING", "STARTING")) { state = "INTERRUPTED"; failure = "SERVICE_DESTROYED_NO_END" }
    super.onDestroy()
  }
  override fun onBind(intent: Intent?): IBinder? = null
}
