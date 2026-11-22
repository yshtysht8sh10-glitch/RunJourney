package app.runjourney.announcer
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
class SpeechClarityTest {
  private fun wav(): ByteArray {
    val bytes=ByteArray(44+32000);val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    b.put("RIFF".toByteArray()).putInt(bytes.size-8).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16).put("data".toByteArray()).putInt(32000)
    for(i in 0 until 16000) b.putShort(((if(i in 8000..8319).7 else .06)*sin(i*2*PI*440/16000)*32767).toInt().toShort())
    return bytes
  }
  @Test fun quietSpeechRisesWithNoNewPeakOrClipping() {
    val result=SpeechClarity.compress(wav())
    assertEquals("APPLIED",result.status);assertTrue(result.afterRms>result.beforeRms)
    assertTrue(result.afterPeak<=result.beforePeak+.00001);assertTrue(result.afterPeak<=.9)
    assertTrue(result.afterRms<=result.beforeRms*1.6)
  }
  @Test fun malformedAndUnsupportedAudioIsUnchanged() {
    val bytes=wav();bytes[34]=24;val before=bytes.clone()
    assertEquals("SKIPPED_FORMAT",SpeechClarity.compress(bytes).status);assertArrayEquals(before,bytes)
    assertEquals("SKIPPED_FORMAT",SpeechClarity.compress(ByteArray(10)).status)
  }
}
