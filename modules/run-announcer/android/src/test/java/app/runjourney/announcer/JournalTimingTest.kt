package app.runjourney.announcer
import org.junit.Assert.*
import org.junit.Test
@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk=[28])
class JournalTimingTest {
 @Test fun quantilesAreBoundedAndKeepExactMaximum(){
  val s=JournalTiming();for(i in 1..100)s.add(i.toDouble());s.add(Double.NaN)
  val j=s.json();assertEquals(100,j.getInt("count"));assertEquals(50.0,j.getDouble("p50"),.001);assertEquals(95.0,j.getDouble("p95"),.001)
  s.add(500.0);assertEquals(500.0,s.json().getDouble("max"),.001);s.clear();assertEquals(0,s.json().getInt("count"))
 }
}
