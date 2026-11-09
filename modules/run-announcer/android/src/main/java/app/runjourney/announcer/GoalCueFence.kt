package app.runjourney.announcer

import android.content.Context

/** Audio-only tombstone. Do not confuse voice mute with a completed RUN. */
internal object GoalCueFence {
  @Synchronized
  fun finish(context: Context, id: String): Boolean {
    val prefs=context.getSharedPreferences("runjourney-voice-debug",0)
    val ended=prefs.getStringSet("endedGoalCueRuns",emptySet())!!.toMutableSet()
    ended.add(id)
    return prefs.edit().putStringSet("endedGoalCueRuns",ended).commit()
  }
  fun ended(context: Context,id: String) = context.getSharedPreferences("runjourney-voice-debug",0)
    .getStringSet("endedGoalCueRuns",emptySet())!!.contains(id)
}
