package app.runjourney.announcer
import org.junit.Assert.*
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone
class CurrentTimePolicyTest {
 @Test fun boundariesAndLongRunNeverUseClockHourAsInterval() {
  val start = 1800000000000L
  for(minutes in listOf(5,10,15,30)) {
   assertEquals(0L, CurrentTimePolicy.boundary(start,start+minutes*60000-1,minutes))
   assertEquals(1L, CurrentTimePolicy.boundary(start,start+minutes*60000,minutes))
   assertEquals(2880L/minutes, CurrentTimePolicy.boundary(start,start+48*3600000L,minutes))
  }
 }
 @Test fun localNoonMidnightAndMinuteRollover() {
  val old=TimeZone.getDefault()
  try {
   TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"))
   val c=Calendar.getInstance().apply { set(2026,9,31,7,35,0) }
   assertEquals("現在、午前7時35分です",CurrentTimePolicy.message(c.timeInMillis))
   c.set(Calendar.HOUR_OF_DAY,12); c.set(Calendar.MINUTE,0)
   assertEquals("現在、午後12時0分です",CurrentTimePolicy.message(c.timeInMillis))
   c.set(Calendar.HOUR_OF_DAY,0)
   assertEquals("現在、午前12時0分です",CurrentTimePolicy.message(c.timeInMillis))
  } finally { TimeZone.setDefault(old) }
 }
}
