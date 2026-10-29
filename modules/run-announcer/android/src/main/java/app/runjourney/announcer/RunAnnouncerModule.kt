package app.runjourney.announcer

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.Manifest
import android.content.pm.PackageManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RunAnnouncerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RunAnnouncer")
    Events("finishClock")
    Function("noiseControl") { action: String, runId: String ->
      val context = requireNotNull(appContext.reactContext)
      val preferences = context.getSharedPreferences(RunAnnouncerService.PREFS, 0)
      if (action == "enable") {
        preferences.edit().putBoolean("noiseUserStopped", false).putBoolean("noiseConfigured", true).apply(); "READY"
      } else if (action == "stop") {
        preferences.edit().putBoolean("noiseUserStopped", true).putBoolean("noiseConfigured", false).apply()
        context.stopService(Intent(context, NoiseMonitorService::class.java)); "OFF"
      } else if (action == "finish") {
        // Only shorten an already-running lease; never start a microphone from background.
        if (NoiseState.running || NoiseState.status == "STARTING") context.startService(Intent(context, NoiseMonitorService::class.java).setAction("FINISH"))
        "FINISHING"
      } else if (action == "start" && preferences.getBoolean("noiseUserStopped", false)) "USER_STOPPED"
      else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) "PERMISSION_DENIED"
      else if (appContext.currentActivity?.hasWindowFocus() != true) "VISIBLE_ACTIVITY_REQUIRED"
      else try {
        NoiseState.status = "STARTING"
        if (action == "preview") preferences.edit().putBoolean("noiseUserStopped", false).apply()
        val intent = Intent(context, NoiseMonitorService::class.java).putExtra("runId", runId)
          .putExtra("leaseMs", if (action == "preview") 20000L else 21600000L)
        context.startForegroundService(intent)
        if (action == "preview") Handler(Looper.getMainLooper()).postDelayed({
          val speech = Intent(context, RunAnnouncerService::class.java).setAction(RunAnnouncerService.ACTION_TEST)
            .putExtra("message", "騒音に合わせた音量のテストです。周囲が騒がしくなると案内の音量を少し上げ、静かになるとゆっくり戻します。音量は端末の設定が上限です。")
          try { context.startForegroundService(speech) } catch (_: Exception) { }
        }, 2500)
        "STARTING"
      } catch (_: Exception) { NoiseState.audit(context, "START_RESTRICTED", runId); "START_RESTRICTED" }
    }
    Function("noiseDiagnostics") {
      mapOf("status" to NoiseState.status, "running" to NoiseState.running, "gain" to NoiseState.gain,
        "dbfs" to NoiseState.dbfs, "baselineDbfs" to NoiseState.baseline, "inputType" to NoiseState.inputType,
        "outputType" to NoiseState.outputType, "updatedAt" to NoiseState.updatedAt,
        "summary" to NoiseState.snapshot(requireNotNull(appContext.reactContext)).toString())
    }
    Function("appendDiagnostic") { payload: String ->
      VoiceLogStorage.append(requireNotNull(appContext.reactContext), payload, System.currentTimeMillis())
    }
    OnCreate { FinishClockService.pulse = { sendEvent("finishClock", emptyMap<String, Any>()) } }
    OnDestroy { FinishClockService.pulse = null }
    Function("finishClock") { enabled: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(context, FinishClockService::class.java)
      if (enabled) {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } else context.stopService(intent)
      Unit
    }

    AsyncFunction("voiceLog") { limit: Int, promise: Promise ->
      VoiceLogStorage.read(requireNotNull(appContext.reactContext), limit, promise)
    }
    // Dispatch the tiny service intent directly; do not wait on the shared
    // async-module executor behind database/file work. Playback stays async.
    Function("notifyBatch") { payload: String ->
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(context, RunAnnouncerService::class.java).apply {
        action = RunAnnouncerService.ACTION_BATCH
        putExtra("payload", payload)
      }
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      Unit
    }

    Function("updateWorkout") { key: String, message: String, expiresAt: Double, allowed: Boolean ->
      val context = requireNotNull(appContext.reactContext)
      val prefs = context.getSharedPreferences(RunAnnouncerService.PREFS, 0)
      prefs.edit().putBoolean("workoutAllowed", allowed).apply()
      if (allowed && message.isNotBlank() && expiresAt > System.currentTimeMillis() && prefs.getString("workoutKey", "") != key) {
        prefs.edit().putString("workoutKey", key).apply()
        val intent = Intent(context, RunAnnouncerService::class.java).apply {
          action = RunAnnouncerService.ACTION_WORKOUT
          putExtra("message", message)
          putExtra("expiresAt", expiresAt.toLong())
        }
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      }
    }

    Function("start") { startedAtMs: Double, intervalMs: Double ->
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(context, RunAnnouncerService::class.java).apply {
        action = RunAnnouncerService.ACTION_START
        putExtra("startedAtMs", startedAtMs.toLong())
        putExtra("intervalMs", intervalMs.toLong())
      }
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    Function("updateClock") { activeMs: Double, paused: Boolean, confirmedActiveMs: Double ->
      val context = requireNotNull(appContext.reactContext)
      context.getSharedPreferences(RunAnnouncerService.PREFS, 0).edit()
        .putLong("activeMs", activeMs.toLong()).putLong("clockUpdatedMs", System.currentTimeMillis())
        .putBoolean("paused", paused).putLong("confirmedActiveMs", confirmedActiveMs.toLong()).apply()
    }
    Function("transition") { eventKey: String, message: String ->
      val context = requireNotNull(appContext.reactContext)
      val prefs = context.getSharedPreferences(RunAnnouncerService.PREFS, 0)
      val parts = eventKey.split(":")
      val runId = parts.first()
      val eventIndex = parts.getOrNull(1)?.toIntOrNull() ?: -1
      val lastIndex = if (prefs.getString("transitionRun", "") == runId) prefs.getInt("transitionIndex", -1) else -1
      if (eventIndex > lastIndex) {
        prefs.edit().putString("transitionRun", runId).putInt("transitionIndex", eventIndex).apply()
        val intent = Intent(context, RunAnnouncerService::class.java).apply {
          action = RunAnnouncerService.ACTION_TEST
          putExtra("message", message)
        }
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      }
    }
    Function("updateDistance") { distanceMeters: Double ->
      val context = requireNotNull(appContext.reactContext)
      context.getSharedPreferences(RunAnnouncerService.PREFS, 0).edit()
        .putFloat("distanceMeters", distanceMeters.toFloat()).apply()
    }

    Function("updateAnnouncement") { intervalIndex: Int, message: String ->
      val context = requireNotNull(appContext.reactContext)
      context.getSharedPreferences(RunAnnouncerService.PREFS, 0).edit()
        .putInt("messageInterval", intervalIndex).putString("message", message).apply()
    }

    Function("diagnostics") {
      val prefs = requireNotNull(appContext.reactContext).getSharedPreferences(RunAnnouncerService.PREFS, 0)
      mapOf("running" to prefs.getBoolean("running", false), "transitionRun" to prefs.getString("transitionRun", ""),
        "transitionIndex" to prefs.getInt("transitionIndex", -1), "ttsStatus" to prefs.getString("ttsStatus", "UNKNOWN"),
        "ttsStartedAt" to prefs.getLong("ttsStartedAt", 0))
    }

    Function("test") { message: String ->
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(context, RunAnnouncerService::class.java).apply {
        action = RunAnnouncerService.ACTION_TEST
        putExtra("message", message)
      }
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    Function("stop") {
      val context = requireNotNull(appContext.reactContext)
      context.getSharedPreferences(RunAnnouncerService.PREFS, 0).edit().putBoolean("running", false).putBoolean("workoutAllowed", false).apply()
      // Deliver termination through the queue so an already-started chime can
      // finish. This never waits for sound before saving the actual run.
      RunAnnouncerService.stopRunning?.invoke() ?: context.stopService(Intent(context, RunAnnouncerService::class.java))
      Unit
    }
  }
}
