package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test

class SynthesisBudgetTest {
  @Test fun shortPaceAndKilometerNoticesKeepExistingDeadline() {
    assertEquals(3000L, SynthesisBudget.timeoutMs("あ".repeat(15)))
    assertEquals(3000L, SynthesisBudget.timeoutMs("あ".repeat(45)))
  }
  @Test fun FieldSummariesHaveHeadroomBeyondObservedThreeSecondTimeout() {
    assertTrue(SynthesisBudget.timeoutMs("あ".repeat(90)) >= 5000L)
    assertTrue(SynthesisBudget.timeoutMs("あ".repeat(111)) >= 6000L)
  }
  @Test fun EmptyAndUnexpectedlyLargeMessagesHaveBoundedWait() {
    assertEquals(3000L, SynthesisBudget.timeoutMs(""))
    assertEquals(8000L, SynthesisBudget.timeoutMs("あ".repeat(10000)))
  }
}
