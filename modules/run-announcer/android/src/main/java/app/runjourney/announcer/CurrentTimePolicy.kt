package app.runjourney.announcer

import java.util.Calendar
internal object CurrentTimePolicy {
  fun boundary(started: Long, now: Long, minutes: Int): Long = if (started <= 0 || now < started || minutes !in listOf(5, 10, 15, 30)) 0 else (now - started) / (minutes * 60000L)
  fun message(now: Long): String {
    val c = Calendar.getInstance().apply { timeInMillis = now }
    val hour = c.get(Calendar.HOUR).let { if (it == 0) 12 else it }
    return "現在、${if(c.get(Calendar.AM_PM) == Calendar.AM) "午前" else "午後"}${hour}時${c.get(Calendar.MINUTE)}分です"
  }
}
