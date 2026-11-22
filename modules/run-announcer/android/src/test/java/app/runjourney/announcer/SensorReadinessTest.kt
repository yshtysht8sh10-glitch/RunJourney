package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test

class SensorReadinessTest {
  @Test fun registrationOrOneStreamCannotEstablishReadiness() {
    val r = SensorReadiness()
    assertFalse(r.ready()); assertNull(r.age(1, 100))
    assertTrue(r.receive(1, 100)); assertFalse(r.ready())
    assertFalse(r.receive(1, 200)); assertFalse(r.ready())
    assertTrue(r.receive(4, 210)); assertTrue(r.ready())
  }
  @Test fun eitherStreamStallingInvalidatesReceiptReadiness() {
    val r = SensorReadiness(); r.receive(1, 100); r.receive(4, 100)
    r.receive(1, 10_102)
    assertTrue(r.stale(10_102)); assertEquals(10_002L, r.age(4, 10_102))
  }
  @Test fun resetDoesNotReusePreviousRunSamplesOrUnsupportedTypes() {
    val r = SensorReadiness(); r.receive(1, 100); r.receive(4, 110)
    r.reset(); assertFalse(r.ready()); assertNull(r.age(4, 1000))
    assertFalse(r.receive(5, 1000)); assertFalse(r.ready())
  }
}
