package app.runjourney.announcer

import android.Manifest
import android.annotation.SuppressLint
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.media.*
import android.os.*
import org.json.JSONObject

internal object NoiseState {
  @Volatile var measurementRunId = ""
  @Volatile var running = false
  @Volatile var gain = 1f
  @Volatile var dbfs = -90.0
  @Volatile var baseline = -90.0
  @Volatile var updatedAt = 0L
  @Volatile var status = "OFF"
  @Volatile var playback = false
  @Volatile var externalOutput = false
  @Volatile var inputType = 0
  @Volatile var outputType = 0
  @Volatile var samples = 0L
  @Volatile var sumDbfs = 0.0
  @Volatile var minDbfs = 0.0
  @Volatile var maxDbfs = -90.0
  @Volatile var screenOffSamples = 0L
  @Volatile var startedAt = 0L
  fun snapshot(context: Context): JSONObject {
    val manager = context.getSystemService(AudioManager::class.java)
    return JSONObject().put("measurementRunId", measurementRunId).put("running", running).put("routeKnown", outputType != 0).put("status", status).put("gain", gain)
      .put("configured", context.getSharedPreferences(RunAnnouncerService.PREFS, 0).getBoolean("noiseConfigured", false))
      .put("microphoneGranted", context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
      .put("dbfs", dbfs).put("baselineDbfs", baseline).put("inputType", inputType).put("outputType", outputType)
      .put("screenInteractive", context.getSystemService(PowerManager::class.java).isInteractive)
      .put("mediaVolume", manager.getStreamVolume(AudioManager.STREAM_MUSIC)).put("mediaVolumeMax", manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
      .put("samples", samples).put("meanDbfs", if(samples > 0) sumDbfs / samples else JSONObject.NULL)
      .put("minDbfs", if(samples > 0) minDbfs else JSONObject.NULL).put("maxDbfs", if(samples > 0) maxDbfs else JSONObject.NULL)
      .put("screenOffSamples", screenOffSamples).put("startedAt", startedAt).put("updatedAt", updatedAt)
      .put("rawAudioStored", false)
  }
  fun available() = running && System.currentTimeMillis() - updatedAt in 0..2000
  fun audit(context: Context, status: String, runId: String = "") {
    VoiceLogStorage.append(context, JSONObject().put("type", "NOISE_LEVEL").put("status", status)
      .put("loggedAt", System.currentTimeMillis()).put("data", JSONObject().put("runId", runId)
        .put("dbfs", dbfs).put("baselineDbfs", baseline).put("gain", gain).put("inputType", inputType).put("outputType", outputType)
        .put("summary", snapshot(context)).put("speakerFeedbackHold", playback && !externalOutput).put("rawAudioStored", false)).toString(), System.currentTimeMillis())
  }
}

class NoiseMonitorService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var capture = false
  @Volatile private var recorder: AudioRecord? = null
  private var worker: Thread? = null
  private var runId = ""
  private val expiry = Runnable { stopSelf() }
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "STOP") {
      getSharedPreferences(RunAnnouncerService.PREFS, 0).edit().putBoolean("noiseUserStopped", true).apply()
      stopSelf(); return START_NOT_STICKY
    }
    if (intent?.action == "FINISH") { handler.removeCallbacks(expiry); handler.postDelayed(expiry, 40000); return START_NOT_STICKY }
    if (worker != null) return START_NOT_STICKY
    if (getSharedPreferences(RunAnnouncerService.PREFS, 0).getBoolean("noiseUserStopped", false)) { stopSelf(); return START_NOT_STICKY }
    runId = intent?.getStringExtra("runId") ?: ""
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      NoiseState.status = "PERMISSION_DENIED"; NoiseState.audit(this, NoiseState.status, runId); stopSelf(); return START_NOT_STICKY
    }
    try {
      getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("runjourney-noise", "騒音連動音量", NotificationManager.IMPORTANCE_LOW))
      val stop = PendingIntent.getService(this, 609, Intent(this, NoiseMonitorService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      startForeground(609, Notification.Builder(this, "runjourney-noise").setSmallIcon(applicationInfo.icon)
        .setContentTitle("RunJourney 騒音レベル測定中").setContentText("音声は保存しません。音量は端末の設定が上限です。")
        .addAction(Notification.Action.Builder(null, "測定を停止", stop).build()).setOngoing(true).build())
      NoiseState.measurementRunId = runId
      NoiseState.samples = 0; NoiseState.sumDbfs = 0.0; NoiseState.minDbfs = 0.0; NoiseState.maxDbfs = -90.0; NoiseState.screenOffSamples = 0; NoiseState.startedAt = System.currentTimeMillis()
      capture = true
      worker = Thread({ measure() }, "RunJourneyNoise").also { it.start() }
      handler.postDelayed(expiry, (intent?.getLongExtra("leaseMs", 21600000) ?: 21600000).coerceIn(10000, 21600000))
    } catch (_: Exception) { NoiseState.status = "START_RESTRICTED"; NoiseState.audit(this, NoiseState.status, runId); stopSelf() }
    return START_NOT_STICKY
  }
  @SuppressLint("MissingPermission") // Checked before start; revocation/read failure falls back to normal speech.
  private fun measure() {
    val pcm = ShortArray(3200) // 200ms at 16kHz; RAM only, overwritten after RMS.
    val policy = NoiseGain()
    var record: AudioRecord? = null
    try {
      val minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minimum > 0) { "Unsupported sample rate" }
      val manager = getSystemService(AudioManager::class.java)
      val source = if (manager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true") MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.VOICE_RECOGNITION
      record = AudioRecord(source, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum * 2, pcm.size * 2))
      recorder = record
      check(record.state == AudioRecord.STATE_INITIALIZED)
      // Use the phone microphone, without switching Bluetooth to a call/SCO route.
      val builtIn = manager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
      check(builtIn != null && record.setPreferredDevice(builtIn)) { "Phone microphone unavailable" }
      record.startRecording(); check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING)
      NoiseState.running = true; NoiseState.status = "CALIBRATING"; NoiseState.audit(this, NoiseState.status, runId)
      var lastAudit = 0L
      while (capture) {
        val count = record.read(pcm, 0, pcm.size, AudioRecord.READ_BLOCKING)
        check(count > 0) { "Microphone read failed" }
        if (Build.VERSION.SDK_INT >= 29) check(record.activeRecordingConfiguration?.isClientSilenced != true) { "Microphone silenced by system" }
        val level = NoiseGain.dbfs(pcm, count); pcm.fill(0)
        NoiseState.inputType = record.routedDevice?.type ?: 0
        val hold = NoiseState.playback && !NoiseState.externalOutput
        if (!hold) {
          NoiseState.samples++; NoiseState.sumDbfs += level
          NoiseState.minDbfs = minOf(NoiseState.minDbfs, level); NoiseState.maxDbfs = maxOf(NoiseState.maxDbfs, level)
          if (!getSystemService(PowerManager::class.java).isInteractive) NoiseState.screenOffSamples++
        }
        NoiseState.gain = policy.update(level, count / 16000.0, hold)
        NoiseState.dbfs = if (hold) NoiseState.dbfs else level
        NoiseState.baseline = policy.baselineDb; NoiseState.updatedAt = System.currentTimeMillis()
        NoiseState.status = if (hold) "SELF_AUDIO_HOLD" else if (policy.calibrated) "MONITORING" else "CALIBRATING"
        if (NoiseState.updatedAt - lastAudit >= 5000) { NoiseState.audit(this, NoiseState.status, runId); lastAudit = NoiseState.updatedAt }
      }
    } catch (_: Exception) {
      if (capture) { NoiseState.status = "MIC_UNAVAILABLE"; NoiseState.audit(this, NoiseState.status, runId) }
    } finally {
      pcm.fill(0); NoiseState.running = false; NoiseState.gain = 1f
      if (NoiseState.status !in listOf("MIC_UNAVAILABLE", "START_RESTRICTED", "PERMISSION_DENIED")) NoiseState.status = "STOPPED"
      try { record?.stop() } catch (_: Exception) { }
      record?.release(); recorder = null
      handler.post { stopSelf() }
    }
  }
  override fun onDestroy() {
    capture = false; handler.removeCallbacks(expiry)
    try { recorder?.stop() } catch (_: Exception) { }
    NoiseState.running = false; NoiseState.gain = 1f
    if (NoiseState.status !in listOf("MIC_UNAVAILABLE", "START_RESTRICTED", "PERMISSION_DENIED")) NoiseState.status = "STOPPED"
    NoiseState.audit(this, "STOPPED", runId)
    super.onDestroy()
  }
}
