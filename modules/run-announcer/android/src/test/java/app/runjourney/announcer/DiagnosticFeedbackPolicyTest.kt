package app.runjourney.announcer

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class DiagnosticFeedbackPolicyTest {
  @Test fun durableAckPrecedesSpeechAndFailedWritesNeverPublishSuccess() {
    for (failure in listOf("", "MARKER", "ACK")) {
      val trace = mutableListOf<String>()
      try {
        MarkerAcknowledgement.persist(
          { trace.add("MARKER"); if (failure == "MARKER") throw IOException() },
          { trace.add("ACK_SYNC"); if (failure == "ACK") throw IOException() },
          { trace.add("VOICE") })
      } catch (_: IOException) { }
      assertEquals(failure.isEmpty(), trace.contains("VOICE"))
      if (failure.isEmpty()) assertEquals(listOf("MARKER", "ACK_SYNC", "VOICE"), trace)
    }
  }
  @Test fun savedLabelsAndUnpreparedOrRejectedPressesCannotBecomeSuccess() {
    assertEquals("BEGIN_SAVED", DiagnosticFeedbackPolicy.savedKind("BEGIN", true))
    assertEquals("END_SAVED", DiagnosticFeedbackPolicy.savedKind("END", true))
    assertEquals("", DiagnosticFeedbackPolicy.savedKind("BEGIN", false))
    assertEquals("", DiagnosticFeedbackPolicy.savedKind("STOP", true))
    for (r in listOf("DUPLICATE", "DUPLICATE_DOWN", "REPEAT", "UNRELATED", "NOT_DOWN")) assertFalse(DiagnosticFeedbackPolicy.rejectedPress(r))
    assertTrue(DiagnosticFeedbackPolicy.rejectedPress("ACCEPTED"))
  }
  @Test fun staleRunOrSessionCannotSpeakAndInterruptRetryIsBounded() {
    assertTrue(DiagnosticFeedbackPolicy.valid("r", "s", "r", "s", "old"))
    assertFalse(DiagnosticFeedbackPolicy.valid("r", "s", "r", "new", ""))
    assertFalse(DiagnosticFeedbackPolicy.valid("r", "s", "r", "s", "r"))
    assertFalse(DiagnosticFeedbackPolicy.valid("", "s", "", "s", ""))
    assertTrue(DiagnosticFeedbackPolicy.retryInterrupted(0, true))
    assertFalse(DiagnosticFeedbackPolicy.retryInterrupted(2, true))
    assertFalse(DiagnosticFeedbackPolicy.retryInterrupted(0, false))
  }
}
