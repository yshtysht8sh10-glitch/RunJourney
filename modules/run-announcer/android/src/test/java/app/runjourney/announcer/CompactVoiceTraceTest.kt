package app.runjourney.announcer

import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class CompactVoiceTraceTest {
  private lateinit var directory:File
  @Before fun setup(){directory=Files.createTempDirectory("compact-voice-").toFile()}
  private fun payload(id:Int=1,run:String="r",status:String="STARTED")=JSONObject().put("id","notice:$id").put("type","PACE_WARNING").put("status",status)
    .put("message","PRIVATE_SPOKEN_TEXT").put("data",JSONObject().put("runId",run).put("latitude",35.1234567).put("longitude",139.7654321)
      .put("route","PRIVATE_ROUTE").put("cryptoKey","PRIVATE_SECRET").put("generatedAt",id*1000L).put("pacePeriodicSnapshot",JSONObject().put("slot",id).put("startAt",0).put("endAt",id*1000L).put("quality","READY"))).toString()
  @Test fun strictFieldAllowlistExcludesCoordinatesRouteKeysMessageAndRawIdentifiers(){
    val trace=CompactVoiceTrace(directory);trace.append(payload(),1000)
    val stats=JSONObject(trace.stats("r"));val page=trace.page("r",0,stats.getLong("readableBytes"))
    for(secret in listOf("PRIVATE_","35.1234567","139.7654321","latitude","longitude","cryptoKey","notice:1","\"message\""))assertFalse(secret,page.contains(secret))
    val row=JSONObject(page).getJSONArray("entries").getJSONObject(0)
    assertEquals("PACE_WARNING",row.getString("noticeType"));assertEquals("START",row.getString("phase"));assertEquals(1000,row.getInt("generatedAt"))
  }
  @Test fun full150MinuteAndFourHourSyntheticTracesRetainFirstLastAndSequence(){
    val begin=System.nanoTime()
    for(seconds in listOf(9000,14400)) {
      val run="run-$seconds";val trace=CompactVoiceTrace(directory)
      for(i in 1..seconds)trace.append(payload(i,run,if(i%4==0)"DONE" else if(i%4==1)"GENERATED" else if(i%4==2)"QUEUED" else "STARTED"),i*1000L)
      val stats=JSONObject(trace.stats(run));assertFalse(stats.getBoolean("incomplete"));assertEquals(seconds.toLong(),stats.getLong("records"));assertTrue(stats.getLong("bytes")<8L*1024*1024)
      val reopened=CompactVoiceTrace(directory);val end=stats.getLong("readableBytes");var offset=0L;var expected=1L
      while(offset<end){val page=JSONObject(reopened.page(run,offset,end));val rows=page.getJSONArray("entries");for(i in 0 until rows.length())assertEquals(expected++,rows.getJSONObject(i).getLong("seq"));offset=page.getLong("nextOffset")}
      assertEquals(seconds+1L,expected)
      println("COMPACT_MEASURE seconds=$seconds records=${stats.getLong("records")} bytes=${stats.getLong("bytes")}")
    }
    println("COMPACT_SYNTHETIC_TOTAL_MS=${(System.nanoTime()-begin)/1000000}")
  }
  @Test fun fixedSnapshotPagesExcludeLaterAppendsAndRejectNonBoundaryOffsets(){
    val trace=CompactVoiceTrace(directory);repeat(3){trace.append(payload(it),it.toLong())}
    val end=JSONObject(trace.stats("r")).getLong("readableBytes");trace.append(payload(99),99)
    assertEquals(3,JSONObject(trace.page("r",0,end)).getJSONArray("entries").length())
    for(pair in listOf(1L to end,0L to end-1,0L to end+99999))try{trace.page("r",pair.first,pair.second);fail("range accepted")}catch(_:IllegalArgumentException){}
  }
  @Test fun capacityStopsOnlyNewTraceWithoutPruningAndFlagsSurviveRestart(){
    val trace=CompactVoiceTrace(directory,perRunLimit=800,totalLimit=900);repeat(20){trace.append(payload(it),it.toLong())}
    val s=JSONObject(trace.stats("r"));assertTrue(s.getBoolean("incomplete"));assertEquals("RUN_CAPACITY",s.getString("stoppedReason"));assertTrue(s.getLong("bytes")<=800)
    val before=File(directory,"${CompactVoiceTrace.key("r")}.ndjson").readBytes();trace.append(payload(55),55)
    assertArrayEquals(before,File(directory,"${CompactVoiceTrace.key("r")}.ndjson").readBytes())
    assertTrue(JSONObject(CompactVoiceTrace(directory,800,900).stats("r")).getBoolean("incomplete"))
    repeat(10){trace.append(payload(it,"another"),it.toLong())}
    assertTrue(JSONObject(trace.stats("another")).getBoolean("incomplete"))
    assertEquals("GLOBAL_CAPACITY",JSONObject(trace.stats("another")).getString("stoppedReason"))
  }
  @Test fun interruptedTailIsNeverTruncatedOrOverwritten(){
    var trace=CompactVoiceTrace(directory);trace.append(payload(),1)
    val file=File(directory,"${CompactVoiceTrace.key("r")}.ndjson");file.appendText("{partial")
    val before=file.readBytes();trace=CompactVoiceTrace(directory)
    val stats=JSONObject(trace.stats("r"));assertTrue(stats.getBoolean("partialTail"));assertEquals(1,stats.getInt("records"));assertTrue(stats.getLong("readableBytes")<stats.getLong("bytes"))
    trace.append(payload(2),2);assertArrayEquals(before,file.readBytes())
  }
  @Test fun partialWriteFailureStopsOnlyTraceAndKeepsPartialBytesForInspection(){
    val trace=CompactVoiceTrace(directory,writeRecord={file,bytes->file.appendBytes(bytes.copyOf(12));throw java.io.IOException("fixture")})
    try{trace.append(payload(),1);fail("write accepted")}catch(_:java.io.IOException){}
    val stats=JSONObject(trace.stats("r"));assertEquals("WRITE_FAILED",stats.getString("stoppedReason"));assertTrue(stats.getBoolean("incomplete"));assertTrue(stats.getBoolean("partialTail"))
    val file=File(directory,"${CompactVoiceTrace.key("r")}.ndjson");val before=file.readBytes();trace.append(payload(2),2);assertArrayEquals(before,file.readBytes())
    assertEquals(12,stats.getInt("globalBytes"));assertEquals(12,JSONObject(CompactVoiceTrace(directory).stats("r")).getInt("globalBytes"))
  }
  @Test fun queueOverflowFlagsPersistAndDoNotDependOnRollingJournalRetention(){
    val trace=CompactVoiceTrace(directory);trace.append(payload(),1);trace.loss("r",7);trace.globalLoss(2)
    val reopened=CompactVoiceTrace(directory);val stats=JSONObject(reopened.stats("r"))
    assertEquals(7,stats.getInt("dropped"));assertTrue(stats.getBoolean("incomplete"));assertEquals(2,stats.getInt("globalDropped"));assertTrue(stats.getBoolean("globalIncomplete"))
  }
  @Test fun newProcessWithoutObservedEndIsMarkedUncleanWithoutDeletingPrefix(){
    val first=CompactVoiceTrace(directory,session="process-a");first.append(payload(),1)
    val file=File(directory,"${CompactVoiceTrace.key("r")}.ndjson");val prefix=file.readBytes()
    val next=CompactVoiceTrace(directory,session="process-b")
    assertTrue(JSONObject(next.stats("r")).getBoolean("uncleanRestart"));assertArrayEquals(prefix,file.readBytes())
    next.append(payload(2),2);assertEquals(2,JSONObject(next.stats("r")).getInt("records"))
  }
  @Test fun observedFinalVoiceCompletionFlushesTraceBeforeClosingSessionMarker(){
    val first=CompactVoiceTrace(directory,session="process-a");first.append(payload(),1)
    first.append(JSONObject(payload(2,status="DONE")).put("type","RUN_GOAL_FINISHED").toString(),2)
    val stats=JSONObject(CompactVoiceTrace(directory,session="process-b").stats("r"))
    assertTrue(stats.getBoolean("runEndObserved"));assertFalse(stats.getBoolean("uncleanRestart"));assertEquals(2,stats.getInt("records"))
  }
  @Test fun noTraceIsNeverReportedAsComplete(){
    val stats=JSONObject(CompactVoiceTrace(directory).stats("missing"))
    assertTrue(stats.getBoolean("incomplete"));assertEquals("NO_TRACE",stats.getString("stoppedReason"));assertEquals(0,stats.getInt("records"))
  }
  @Test fun runCatalogAlsoBoundsMetadataWithoutAutoDeletingOldRuns(){
    val trace=CompactVoiceTrace(directory,maxRuns=2)
    trace.append(payload(run="a"),1);trace.append(payload(run="b"),2);trace.append(payload(run="c"),3)
    assertEquals("RUN_CATALOG_CAPACITY",JSONObject(trace.stats("c")).getString("stoppedReason"))
    assertEquals(2,directory.listFiles()!!.count{it.name.endsWith(".meta.json")})
    assertEquals(1,JSONObject(trace.stats("a")).getInt("records"));assertEquals(1,JSONObject(trace.stats("b")).getInt("records"))
    trace.loss("c",4);assertEquals(2,directory.listFiles()!!.count{it.name.endsWith(".meta.json")});assertEquals(5,JSONObject(trace.stats("c")).getInt("globalDropped"))
  }
  @Test fun lossMetadataWriteFailureIsVisibleAndNeverCountedAsDurableSuccess(){
    val trace=CompactVoiceTrace(directory);File(directory,"global-loss.json").mkdir();File(directory,"global-loss.json/blocked").writeText("fixture")
    try{trace.globalLoss(3);fail("metadata failure hidden")}catch(_:Exception){}
    val stats=JSONObject(trace.stats("r"));assertTrue(stats.getBoolean("lossMetadataFailure"));assertTrue(stats.getBoolean("globalIncomplete"));assertEquals(0,stats.getInt("globalDropped"))
  }
  @Test fun realBoundedWorkerOverflowPersistsLossAfterWorkerDrains(){
    val base=RuntimeEnvironment.getApplication()
    val context=object:android.content.ContextWrapper(base){override fun getPackageName()="app.runjourney.mobile.test";override fun getApplicationContext():android.content.Context=this}
    val worker=VoiceLogStorage.javaClass.getDeclaredField("worker").apply{isAccessible=true}.get(VoiceLogStorage) as java.util.concurrent.ThreadPoolExecutor
    val entered=java.util.concurrent.CountDownLatch(1);val release=java.util.concurrent.CountDownLatch(1)
    worker.execute{entered.countDown();release.await(5,java.util.concurrent.TimeUnit.SECONDS)}
    assertTrue(entered.await(5,java.util.concurrent.TimeUnit.SECONDS))
    try{repeat(129){VoiceLogStorage.append(context,payload(it,"overflow-run"),it.toLong())}}finally{release.countDown()}
    val drained=java.util.concurrent.CountDownLatch(1)
    val deadline=System.nanoTime()+5_000_000_000L
    while(true){try{worker.execute{drained.countDown()};break}catch(_:java.util.concurrent.RejectedExecutionException){check(System.nanoTime()<deadline);Thread.sleep(5)}}
    assertTrue(drained.await(10,java.util.concurrent.TimeUnit.SECONDS))
    val trace=VoiceLogStorage.javaClass.getDeclaredMethod("compact",android.content.Context::class.java).apply{isAccessible=true}.invoke(VoiceLogStorage,context) as CompactVoiceTrace
    val stats=JSONObject(trace.stats("overflow-run"));assertTrue(stats.getLong("dropped")>=1);assertTrue(stats.getBoolean("incomplete"))
  }
}
