package app.runjourney.announcer

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import kotlin.math.*

/** Bounded upward compression of generated speech ONLY. No microphone PCM.
 * 20ms look-ahead blocks, at most 1.6x gain for quiet speech, no increase in
 * original peak and a 0.9 digital ceiling. Unknown WAV formats stay untouched. */
internal object SpeechClarity {
  data class Result(val status: String, val beforeRms: Double = 0.0, val afterRms: Double = 0.0,
    val beforePeak: Double = 0.0, val afterPeak: Double = 0.0)
  fun process(file: File): Result = try {
    if (file.length() !in 44..2097152) Result("SKIPPED_SIZE") else {
      val bytes = Files.readAllBytes(file.toPath())
      val result = compress(bytes)
      if (result.status == "APPLIED") Files.newByteChannel(file.toPath(), StandardOpenOption.WRITE).use { channel ->
        val buffer = ByteBuffer.wrap(bytes); while(buffer.hasRemaining()) channel.write(buffer)
      }
      result
    }
  } catch (_: Exception) { Result("SKIPPED_IO") }
  fun compress(bytes: ByteArray): Result {
    if (bytes.size < 44 || String(bytes,0,4,Charsets.US_ASCII) != "RIFF" || String(bytes,8,4,Charsets.US_ASCII) != "WAVE") return Result("SKIPPED_FORMAT")
    val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    var offset=12; var channels=0; var rate=0; var pcm=false; var data=-1; var size=0
    while(offset+8<=bytes.size) {
      val length=b.getInt(offset+4); if(length<0 || length>bytes.size-offset-8) return Result("SKIPPED_FORMAT")
      when(String(bytes,offset,4,Charsets.US_ASCII)) {
        "fmt " -> { if(length<16)return Result("SKIPPED_FORMAT"); channels=b.getShort(offset+10).toInt();rate=b.getInt(offset+12);pcm=b.getShort(offset+8).toInt()==1 && b.getShort(offset+22).toInt()==16 }
        "data" -> { data=offset+8;size=length }
      }
      offset+=8+length+(length%2)
    }
    if(!pcm || channels !in 1..2 || rate !in 8000..96000 || data<0 || size<2 || size%(channels*2)!=0) return Result("SKIPPED_FORMAT")
    val n=size/2; val input=DoubleArray(n){ b.getShort(data+it*2)/32768.0 }
    val peak=input.maxOf { abs(it) }; val rms=sqrt(input.sumOf{it*it}/n)
    if(peak<.005) return Result("SKIPPED_SILENCE",rms,rms,peak,peak)
    val ceiling=min(.9,peak); val output=DoubleArray(n);val block=max(channels,(rate*.02).toInt()*channels)
    var previous=1.0
    for(start in 0 until n step block) {
      val end=min(n,start+block); var energy=0.0;var blockPeak=0.0
      for(i in start until end){energy+=input[i]*input[i];blockPeak=max(blockPeak,abs(input[i]))}
      val level=sqrt(energy/(end-start))
      val target=if(level<.005)1.0 else min(1.6,min(ceiling/max(.00001,blockPeak),sqrt(.12/max(.005,level)))).coerceAtLeast(1.0)
      val from=min(previous,ceiling/max(.00001,blockPeak))
      for(i in start until end) output[i]=input[i]*(from+(target-from)*(i-start+1).toDouble()/(end-start))
      previous=target
    }
    val limiter=min(1.0,ceiling/max(.00001,output.maxOf{abs(it)}))
    val afterRms=sqrt(output.sumOf{(it*limiter).pow(2)}/n);val afterPeak=output.maxOf{abs(it)*limiter}
    if(afterRms<=rms*1.01) return Result("SKIPPED_NO_BENEFIT",rms,rms,peak,peak)
    for(i in 0 until n)b.putShort(data+i*2,(output[i]*limiter*32768).toInt().coerceIn(-32768,32767).toShort())
    return Result("APPLIED",rms,afterRms,peak,afterPeak)
  }
}
