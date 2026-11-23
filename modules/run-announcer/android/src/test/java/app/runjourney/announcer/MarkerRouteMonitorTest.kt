package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test

class MarkerRouteMonitorTest {
  private class Fixture {
    var now = 0L; var owned = true; var output = true; var queryFails = false
    val tasks = mutableMapOf<Runnable, Long>(); val results = mutableListOf<String>()
    val monitor = MarkerRouteMonitor({ r, delay -> tasks[r] = now + delay }, { tasks.remove(it); Unit },
      { owned }, { if (queryFails) error("synthetic audio service failure") else output }, { results.add(it) })
    fun advance(ms: Long) {
      now += ms
      tasks.toList().filter { it.second <= now }.forEach { tasks.remove(it.first); it.first.run() }
    }
  }
  @Test fun inputOnlyRemovalAndRemainingOutputCannotEndRecording() {
    val f=Fixture();f.monitor.removed(false);f.advance(2000);assertTrue(f.results.isEmpty())
    f.monitor.removed(true);f.advance(1000);assertEquals(listOf("BLUETOOTH_OUTPUT_REMAINS"),f.results)
  }
  @Test fun outputProfileRestoredDuringGraceKeepsRecording() {
    val f=Fixture();f.output=false;f.monitor.removed(true);f.advance(999);assertTrue(f.results.isEmpty())
    f.output=true;f.advance(1);assertEquals(listOf("BLUETOOTH_OUTPUT_REMAINS"),f.results)
  }
  @Test fun genuineOutputLossEndsAfterOneRecheck() {
    val f=Fixture();f.output=false;f.monitor.removed(true);f.advance(999);assertTrue(f.results.isEmpty())
    f.advance(1);f.advance(1000);assertEquals(listOf("HEADSET_ROUTE_REMOVED"),f.results)
  }
  @Test fun replacedOrDestroyedSessionCannotCloseTheNewSession() {
    val f=Fixture();f.output=false;f.monitor.removed(true);f.owned=false;f.advance(1000);assertTrue(f.results.isEmpty())
    f.owned=true;f.monitor.removed(true);f.monitor.stop();f.advance(1000);assertTrue(f.results.isEmpty())
  }
  @Test fun repeatedProfileRemovalDebouncesAndAudioQueryFailureIsExplicit() {
    val f=Fixture();f.output=false;f.monitor.removed(true);f.advance(500);f.monitor.removed(true);f.advance(500);assertTrue(f.results.isEmpty())
    f.queryFails=true;f.advance(500);assertEquals(listOf("HEADSET_ROUTE_QUERY_FAILED"),f.results)
  }
}
