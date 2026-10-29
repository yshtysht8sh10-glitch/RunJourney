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
import android.media.MediaPlayer
import android.media.AudioDeviceInfo
import android.os.Bundle
import java.io.File
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import org.json.JSONObject
import org.json.JSONArray

class RunAnnouncerService : Service(), TextToSpeech.OnInitListener {
  companion object {
    const val ACTION_BATCH = "app.runjourney.announcer.BATCH"
    const val ACTION_START = "app.runjourney.announcer.START"
    const val ACTION_TEST = "app.runjourney.announcer.TEST"
    const val ACTION_WORKOUT = "app.runjourney.announcer.WORKOUT"
    const val PREFS = "runjourney-announcer"
    private const val CHANNEL = "runjourney-voice"
    private const val TAG = "RunAnnouncer"
    @Volatile internal var stopRunning: (() -> Unit)? = null
  }

  private val handler = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ready = false
  private var initFailed = false
  private var speaking = false
  private var lastSpeechAt = 0L
  private var pendingWorkout: Pair<String, Long>? = null
  private val messages = mutableListOf<JSONObject>()
  private var currentNotice: JSONObject? = null
  private var lastPriority = 0
  private var batchMode = false
  private var batchRunId = ""
  private var candidateCancelled = false
  private var batchState = "RUNNING"
  private var latestEventIndex = -1
  private var ended = false
  private var chime: MediaPlayer? = null
  private var chimeActive = false
  private var recovery: JSONObject? = null
  private var adaptivePlayer: MediaPlayer? = null
  private var speechFile: File? = null
  private var adaptiveGain = 1f
  private val volumeTick = object : Runnable {
    override fun run() {
      val player = adaptivePlayer ?: return
      try {
        val route = player.routedDevice?.type ?: 0
        NoiseState.outputType = route
        NoiseState.externalOutput = route in listOf(AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET,
          AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLE_HEADSET)
        val gain = if (NoiseState.available()) NoiseState.gain.coerceIn(.65f, 1f) else 1f
        adaptiveGain = gain.coerceIn(adaptiveGain - .1f, adaptiveGain + .1f).coerceIn(.65f, 1f)
        player.setVolume(adaptiveGain, adaptiveGain)
        handler.postDelayed(this, 200)
      } catch (_: Exception) { currentNotice?.let { finishUtterance("ADAPTIVE_VOLUME_ERROR") } }
    }
  }
  private fun clearAdaptive() {
    handler.removeCallbacks(volumeTick)
    adaptivePlayer?.release(); adaptivePlayer = null
    speechFile?.delete(); speechFile = null
    NoiseState.playback = false; NoiseState.externalOutput = false; NoiseState.outputType = 0
  }
  private val debugPrefs by lazy { getSharedPreferences("runjourney-voice-debug", 0) }
  private val seen by lazy {
    val stored = JSONArray(debugPrefs.getString("seen", "[]"))
    (0 until stored.length()).map { stored.getString(it) }.toMutableList()
  }

  private fun audit(n: JSONObject, status: String) {
    try {
      val now = System.currentTimeMillis()
      val record = JSONObject(n.toString()).put("status", status).put("loggedAt", now)
      if (n.has("nativeQueuedAt")) record.put("queueWaitMs", (n.optLong("startedAt", now) - n.optLong("nativeQueuedAt")).coerceAtLeast(0))
      val adaptive = n.optString("playbackMode") == "adaptive-local-synthesis"
      record.put("audio", NoiseState.snapshot(this).put("adaptiveApplied", adaptive)
        .put("appliedGain", if(adaptive) adaptiveGain else 1f)
        .put("fallbackReason", if(adaptive) "" else if(!NoiseState.available()) "MICROPHONE_INACTIVE_OR_STALE" else "IMMEDIATE_STATE_NOTICE_OR_DIRECT_FALLBACK"))
      if (!record.has("startedAt")) record.put("startedAt", JSONObject.NULL)
      VoiceLogStorage.append(applicationContext, record.toString(), now)
    } catch (e: Exception) { Log.w(TAG, "Voice audit unavailable", e) }
  }

  private fun receiveBatch(payload: String) {
    val serviceReceivedAt = System.currentTimeMillis()
    batchMode = true
    val batch = JSONObject(payload)
    val runId = batch.optString("runId")
    val cancel = batch.optBoolean("cancelCandidate")
    val paused = batch.optBoolean("paused")
    val incoming = batch.getJSONArray("notices")
    if (debugPrefs.getString("finishedRun", "") == runId && !batch.optBoolean("ended")) {
      (0 until incoming.length()).forEach { audit(incoming.getJSONObject(it), "RUN_ENDED") }; return
    }
    if (batchRunId.isNotEmpty() && batchRunId != runId) {
      messages.forEach { audit(it, "DISCARDED_RUN_CHANGED") }; messages.clear()
      if (!chimeActive) interrupt("INTERRUPTED_RUN_CHANGED")
      recovery = null
    }
    batchRunId = runId; candidateCancelled = cancel
    batch.optJSONObject("recovery")?.let { recovery = it }
    batchState = batch.optString("state", if (paused) "AUTO_STOP" else "RUNNING")
    latestEventIndex = batch.optInt("latestEventIndex", -1)
    ended = batch.optBoolean("ended")
    if (ended && !batch.optBoolean("muted")) debugPrefs.edit().putString("finishedRun", runId).apply()
    messages.toList().forEach { n ->
      if (!validInState(n)) {
        messages.remove(n); audit(n, "CANCELLED_STATE_OR_CANDIDATE")
      }
    }
    if (currentNotice?.let { !validInState(it) } == true) interrupt("INTERRUPTED_STATE_CHANGED")
    val sorted = (0 until incoming.length()).map { incoming.getJSONObject(it) }.sortedByDescending { it.optInt("priority") }
    sorted.forEach { n ->
      n.put("serviceReceivedAt", serviceReceivedAt)
      val id = n.getString("id")
      if (!seen.contains(id)) {
        seen.add(id); while (seen.size > 2048) seen.removeAt(0)
        val type = n.optString("type")
        if (validInState(n) && n.optInt("priority") >= 80 && messages.size >= 16) {
          messages.minByOrNull { it.optInt("priority") }?.let { old ->
            if (old.optInt("priority") < n.optInt("priority")) { messages.remove(old); audit(old, "EVICTED_FOR_IMPORTANT_NOTICE") }
          }
        }
        val reason = if (initFailed) "INIT_FAILED" else if (!validInState(n) && n.optString("message").isNotBlank()) "STALE_STATE" else VoicePolicy.suppression(type, n.optString("message").isBlank(),
          System.currentTimeMillis(), n.optLong("expiresAt"), paused,
          sorted.any { it.optInt("priority") > 20 && System.currentTimeMillis() <= it.optLong("expiresAt") && it.optString("message").isNotBlank() },
          messages.any { it.optInt("priority") >= 70 }, messages.size)
        if (reason == "QUEUED") n.put("nativeQueuedAt", System.currentTimeMillis())
        audit(n, reason)
        if (reason == "QUEUED") {
          if (VoicePolicy.information(type)) messages.toList().filter { it.optString("type") == type }.forEach {
            messages.remove(it); audit(it, "DISCARDED_NEWER_INFORMATION")
          }
          if (n.optInt("priority") >= 80) messages.filter { VoicePolicy.information(it.optString("type")) }.forEach { defer(it) }
          if (VoicePolicy.information(type) && (paused || chimeActive || (currentNotice?.optInt("priority") ?: 0) >= 80 || messages.any { it.optInt("priority") >= 80 })) defer(n)
          messages.add(n)
        }
      }
    }
    debugPrefs.edit().putString("seen", JSONArray(seen).toString()).apply()
    messages.sortByDescending { it.optInt("priority") }
    val nextPriority = messages.firstOrNull()?.optInt("priority") ?: 0
    // A short, valid stop hint must not wait behind a long lap/periodic notice.
    if (speaking && !chimeActive && VoicePolicy.shouldPreempt(currentNotice?.optInt("priority") ?: 110, nextPriority)) {
      interrupt(if (nextPriority >= 100) "INTERRUPTED_BY_TRANSITION" else "INTERRUPTED_BY_STOP_HINT")
    }
    speakNext()
    if (ready && !speaking && messages.isEmpty()) finishTest()
  }
  private fun validInState(n: JSONObject): Boolean {
    val type = n.optString("type")
    if (type == "LEGACY") return !ended
    if (n.optJSONObject("data")?.optString("runId") != batchRunId) return false
    return VoicePolicy.validState(type, candidateCancelled, batchState, ended,
      n.optJSONObject("data")?.optInt("eventIndex", -1) ?: -1, latestEventIndex)
  }
  private fun defer(n: JSONObject) {
    if (n.optBoolean("deferred")) return
    n.put("deferred", true).put("expiresAt", System.currentTimeMillis() + 120000)
    audit(n, "DEFERRED")
  }
  private fun interrupt(status: String) {
    if (chimeActive) { currentNotice?.let { audit(it, "CHIME_INTERRUPT_BLOCKED") }; return }
    currentNotice?.let {
      audit(it, status)
      if (!ended && validInState(it) && VoicePolicy.information(it.optString("type")) && it.optInt("retry") == 0) {
        val retry = JSONObject(it.toString()).put("originalId", it.optString("id")).put("id", it.optString("id") + ":retry").put("retry", 1)
        retry.remove("startedAt"); defer(retry); messages.add(retry)
      } else audit(it, "DISCARDED")
    }; currentNotice = null
    tts?.stop(); clearAdaptive(); releaseFocus(); speaking = false
  }
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
        if (!batchMode) speak(preferences.getString("message", "") ?: "")
      }
      val next = now + ((due.toLong() + 1) * interval + 10_000 - active)
      handler.postDelayed(this, if (verified) 1_000 else (next - now).coerceIn(1_000, 10_000))
    }
  }

  override fun onCreate() {
    super.onCreate()
    // Only generated speech, never microphone PCM or backup files.
    try { cacheDir.listFiles { file -> file.isFile && file.name.startsWith("runjourney-tts-") }?.forEach { it.delete() } } catch (_: Exception) { }
    stopRunning = { handler.post {
      preferences.edit().putBoolean("running", false).putBoolean("workoutAllowed", false).apply()
      receiveBatch(JSONObject().put("runId", batchRunId).put("ended", true).put("muted", true).put("cancelCandidate", true)
        .put("notices", JSONArray()).toString())
    }; Unit }
    lastSpeechAt = debugPrefs.getLong("lastSpeechAt", 0)
    lastPriority = debugPrefs.getInt("lastPriority", 0)
    val channel = NotificationChannel(CHANNEL, "ランニング音声通知", NotificationManager.IMPORTANCE_LOW)
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    tts = TextToSpeech(this, this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val batch = intent?.action == ACTION_BATCH
    val workout = intent?.action == ACTION_WORKOUT
    val testing = intent?.action == ACTION_TEST || workout || batch
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
    if (batch) {
      receiveBatch(intent?.getStringExtra("payload") ?: "{}")
      return START_NOT_STICKY
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
    initFailed = !ready
    if (ready) {
      tts?.language = Locale.JAPANESE
      pendingTests.forEach { speak(it) }
      pendingTests.clear()
      deliverWorkout()
      speakNext()
      if (!speaking && messages.isEmpty()) finishTest()
    }
    else {
      Log.e(TAG, "Japanese TTS initialization failed: $status")
      preferences.edit().putString("ttsStatus", "INIT_FAILED").apply()
      messages.forEach { audit(it, "INIT_FAILED") }; messages.clear()
      finishTest()
    }
  }

  private fun speak(message: String) {
    if (message.isBlank()) return
    pendingWorkout = null
    messages.add(JSONObject().put("id", "legacy-${System.nanoTime()}").put("message", message).put("type", "LEGACY").put("expiresAt", System.currentTimeMillis() + 20000).put("priority", 40))
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
    // Deferred information follows state feedback, ahead of new periodic items.
    messages.sortByDescending { if (it.optBoolean("deferred")) 75 else it.optInt("priority") }
    val notice = messages.removeAt(0)
    if (batchMode && !validInState(notice)) {
      audit(notice, "STALE_STATE")
      if (messages.isEmpty()) finishTest() else speakNext()
      return
    }
    val now = System.currentTimeMillis()
    if (now > notice.optLong("expiresAt")) {
      audit(notice, if (now > notice.optLong("expiresAt")) "EXPIRED" else "HIGHER_PRIORITY_COOLDOWN")
      if (messages.isEmpty()) finishTest() else speakNext()
      return
    }
    if (notice.optBoolean("deferred")) {
      val fresh = recovery
      if (fresh == null || now - (fresh.optJSONObject("data")?.optLong("sampledAt") ?: 0) > 120000) {
        audit(notice, "DISCARDED_STALE_RECOVERY"); speakNext(); return
      }
      val merged = JSONArray().put(notice.optString("originalId", notice.optString("id")))
      messages.toList().filter { it.optBoolean("deferred") }.forEach {
        messages.remove(it); merged.put(it.optString("originalId", it.optString("id"))); audit(it, "DISCARDED_MERGED_RECOVERY")
      }
      notice.put("message", fresh.getString("message")).put("data", fresh.getJSONObject("data"))
        .put("recoveryOf", merged).put("retry", 1)
      audit(notice, "RESUMED")
    }
    currentNotice = notice
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(attributes).setOnAudioFocusChangeListener { }.build()
    if (audioManager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      audit(notice, "AUDIO_FOCUS_DENIED")
      currentNotice = null
      Log.w(TAG, "Audio focus denied")
      preferences.edit().putString("ttsStatus", "AUDIO_FOCUS_DENIED").apply()
      if (!messages.isEmpty()) handler.post { speakNext() } else finishTest()
      return
    }
    focusRequest = request
    speaking = true
    lastSpeechAt = System.currentTimeMillis()
    lastPriority = notice.optInt("priority")
    debugPrefs.edit().putLong("lastSpeechAt", lastSpeechAt).putInt("lastPriority", lastPriority).apply()
    if (notice.optString("type") in listOf("STOP_CANDIDATE_ANNOUNCED", "AUTO_STOP_CONFIRMED", "AUTO_RESUME_CONFIRMED") && !notice.optBoolean("chimePlayed")) {
      playChime(notice, attributes); return
    }
    speakNotice(notice, attributes)
  }

  private fun playChime(notice: JSONObject, attributes: AudioAttributes) {
    chimeActive = true
    NoiseState.playback = true; NoiseState.externalOutput = false
    notice.put("chimePlayed", true)
    val player = MediaPlayer()
    chime = player
    fun complete(status: String) {
      if (chime !== player) return
      audit(notice, status)
      player.release(); chime = null; chimeActive = false
      NoiseState.playback = false
      if (!validInState(notice) || System.currentTimeMillis() > notice.optLong("expiresAt") || messages.any { it.optInt("priority") > notice.optInt("priority") }) {
        audit(notice, "DISCARDED_STATE_AFTER_CHIME"); currentNotice = null; speaking = false; releaseFocus()
        speakNext(); if (messages.isEmpty() && !speaking) finishTest()
      } else speakNotice(notice, attributes)
    }
    try {
      player.setAudioAttributes(attributes)
      val resource = when (notice.optString("type")) {
        "STOP_CANDIDATE_ANNOUNCED" -> R.raw.run_candidate
        "AUTO_STOP_CONFIRMED" -> R.raw.run_stop
        else -> R.raw.run_resume
      }
      resources.openRawResourceFd(resource).use { fd -> player.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length) }
      player.setOnCompletionListener { complete("CHIME_COMPLETED") }
      player.setOnErrorListener { _, _, _ -> complete("CHIME_FAILED"); true }
      player.setOnPreparedListener {
        if (chime === player) {
          try { player.start(); audit(notice, "CHIME_STARTED") } catch (_: Exception) { complete("CHIME_FAILED") }
        }
      }
      player.prepareAsync()
      handler.postDelayed({ if (chime === player) complete("CHIME_TIMEOUT") }, 2000)
    } catch (_: Exception) { complete("CHIME_FAILED") }
  }

  private fun speakNotice(notice: JSONObject, attributes: AudioAttributes) {
    if (NoiseState.available() && (VoicePolicy.information(notice.optString("type")) || notice.optString("type") in listOf("LEGACY", "RUN_GOAL_FINISHED"))) {
      synthesizeAdaptive(notice, attributes); return
    }
    speakDirect(notice, attributes)
  }

  private fun synthesizeAdaptive(notice: JSONObject, attributes: AudioAttributes) {
    val file = try { File.createTempFile("runjourney-tts-", ".wav", cacheDir) } catch (_: Exception) { speakDirect(notice, attributes); return }
    speechFile = file
    val key = "synthesis-${System.nanoTime()}"
    notice.put("synthesisKey", key)
    fun fallback(reason: String) {
      if (currentNotice !== notice || speechFile !== file) return
      audit(notice, reason); tts?.stop(); clearAdaptive(); speakDirect(notice, attributes)
    }
    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String?) { if (id == key) handler.post { if (speechFile === file) audit(notice, "SYNTHESIS_STARTED") } }
      override fun onDone(id: String?) { if (id == key) handler.post {
        if (currentNotice !== notice || speechFile !== file) return@post
        audit(notice, "SYNTHESIS_COMPLETED")
        try {
          val player = MediaPlayer(); adaptivePlayer = player
          var started = false
          player.setAudioAttributes(attributes); player.setDataSource(file.absolutePath)
          player.setOnPreparedListener {
            if (currentNotice === notice && adaptivePlayer === player) {
              try {
                val gain = if (NoiseState.available()) NoiseState.gain else 1f
                adaptiveGain = gain.coerceIn(.65f, 1f)
                player.setVolume(gain, gain); NoiseState.playback = true
                player.start(); started = true
                notice.put("startedAt", System.currentTimeMillis()).put("playbackMode", "adaptive-local-synthesis")
                audit(notice, "STARTED"); handler.post(volumeTick)
              } catch (_: Exception) { fallback("ADAPTIVE_START_FAILED") }
            }
          }
          player.setOnCompletionListener { if (adaptivePlayer === player) finishUtterance("DONE") }
          player.setOnErrorListener { _, _, _ ->
            if (adaptivePlayer === player) { if (started) finishUtterance("ADAPTIVE_PLAYBACK_ERROR") else fallback("ADAPTIVE_PREPARE_FAILED") }; true
          }
          player.prepareAsync()
          handler.postDelayed({ if (speechFile === file && !started) fallback("ADAPTIVE_PREPARE_TIMEOUT") }, 2000)
          handler.postDelayed({ if (speechFile === file && currentNotice === notice) finishUtterance("PLAYBACK_TIMEOUT") }, 45000)
        } catch (_: Exception) { fallback("ADAPTIVE_PLAYER_FAILED") }
      } }
      override fun onError(id: String?) { if (id == key) handler.post { fallback("SYNTHESIS_FAILED") } }
      override fun onError(id: String?, errorCode: Int) { onError(id) }
    })
    audit(notice, "SYNTHESIS_QUEUED")
    try {
      if (tts?.synthesizeToFile(notice.getString("message"), Bundle(), file, key) != TextToSpeech.SUCCESS) fallback("SYNTHESIS_REJECTED")
    } catch (_: Exception) { fallback("SYNTHESIS_FAILED") }
    handler.postDelayed({ if (speechFile === file && adaptivePlayer == null) fallback("SYNTHESIS_TIMEOUT") }, 3000)
  }

  private fun speakDirect(notice: JSONObject, attributes: AudioAttributes) {
    NoiseState.playback = true; NoiseState.externalOutput = false
    val message = notice.getString("message")
    tts?.setAudioAttributes(attributes)
    val utteranceKey = "runjourney-${System.nanoTime()}"
    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {
        if (utteranceId != utteranceKey) return
        val startedAt = System.currentTimeMillis()
        handler.post { if (currentNotice === notice) { notice.put("startedAt", startedAt); audit(notice, "STARTED") } }
        Log.i(TAG, "Speaking: $message")
        preferences.edit().putString("ttsStatus", "SPEAKING").putLong("ttsStartedAt", System.currentTimeMillis()).apply()
      }
      override fun onDone(utteranceId: String?) { if (utteranceId == utteranceKey) handler.post { if (currentNotice === notice) finishUtterance("DONE") } }
      override fun onError(utteranceId: String?) { if (utteranceId == utteranceKey) handler.post { if (currentNotice === notice) finishUtterance("ERROR") } }
      override fun onError(utteranceId: String?, errorCode: Int) { onError(utteranceId) }
    })
    handler.postDelayed({
      if (currentNotice === notice) { tts?.stop(); finishUtterance("PLAYBACK_TIMEOUT") }
    }, 30000)
    if (tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, utteranceKey) != TextToSpeech.SUCCESS) finishUtterance("SPEAK_FAILED")
  }

  private fun finishUtterance(status: String) {
    clearAdaptive()
    currentNotice?.let { audit(it, status) }; currentNotice = null
    lastSpeechAt = System.currentTimeMillis()
    preferences.edit().putString("ttsStatus", status).apply()
    debugPrefs.edit().putLong("lastSpeechAt", lastSpeechAt).putInt("lastPriority", lastPriority).apply()
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
    if (!preferences.getBoolean("running", false)) handler.post { if (!speaking && messages.isEmpty()) stopSelf() }
  }

  override fun onDestroy() {
    stopRunning = null
    handler.removeCallbacks(tick)
    if (chimeActive) currentNotice?.let { audit(it, "CHIME_INTERRUPTED_SERVICE_DESTROYED") }
    chime?.release(); chime = null; chimeActive = false
    clearAdaptive()
    currentNotice?.let { audit(it, "SERVICE_DESTROYED") }; currentNotice = null
    messages.forEach { audit(it, "SERVICE_DESTROYED") }; messages.clear()
    tts?.stop()
    tts?.shutdown()
    releaseFocus()
    wakeLock?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
