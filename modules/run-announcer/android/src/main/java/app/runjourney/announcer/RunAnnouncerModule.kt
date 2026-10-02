package app.runjourney.announcer

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RunAnnouncerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RunAnnouncer")

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
      if (prefs.getString("lastEvent", "") != eventKey) {
        prefs.edit().putString("lastEvent", eventKey).apply()
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
      context.getSharedPreferences(RunAnnouncerService.PREFS, 0).edit().putBoolean("running", false).apply()
      context.stopService(Intent(context, RunAnnouncerService::class.java))
    }
  }
}
