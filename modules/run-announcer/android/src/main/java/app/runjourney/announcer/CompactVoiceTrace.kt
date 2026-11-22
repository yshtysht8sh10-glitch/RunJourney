package app.runjourney.announcer

import android.util.AtomicFile
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

/** Test telemetry only. Single voice-log worker owns all file access. No pruning. */
internal class CompactVoiceTrace(private val directory:File, private val perRunLimit:Long=8L*1024*1024,
  private val totalLimit:Long=64L*1024*1024,private val session:String=PROCESS_SESSION,private val writeRecord:((File,ByteArray)->Unit)?=null,
  private val maxRuns:Int=256) {
  companion object {
    private val PROCESS_SESSION=java.util.UUID.randomUUID().toString()
    private val CODE_PATTERN=Regex("[A-Z][A-Z0-9_]{0,95}")
    private const val HEX="0123456789abcdef"
    fun key(raw:String):String {
      val digest=MessageDigest.getInstance("SHA-256").digest(raw.toByteArray())
      return buildString(32){for(i in 0 until 16){val v=digest[i].toInt() and 255;append(HEX[v ushr 4]);append(HEX[v and 15])}}
    }
    fun run(payload:String):String = try { JSONObject(payload).optJSONObject("data")?.optString("runId") ?: "" } catch(_:Exception){""}
    private fun code(value:String)=value.takeIf { it.matches(CODE_PATTERN) }
    fun compact(payload:String,at:Long):JSONObject? {
      val source=JSONObject(payload);val data=source.optJSONObject("data");val run=data?.optString("runId") ?: return null
      if(run.isBlank() || run.length>512)return null
      val out=JSONObject().put("v",1).put("runId",key(run)).put("id",key(source.optString("id"))).put("loggedAt",at)
      for(name in listOf("type","status")) code(source.optString(name))?.let{out.put(name,it)}
      val status=out.optString("status");out.put("reason",status)
      val noticeTypes=setOf("PACE_WARNING","CURRENT_TIME","KILOMETER_LAP","FIVE_MINUTES","STOP_CANDIDATE_ANNOUNCED","AUTO_STOP_CONFIRMED","AUTO_RESUME_CONFIRMED","BREAK","RESUME","GOAL_WARNING","WORKOUT_GOAL","RUN_GOAL_FINISHED","RUN_STARTED","TURNAROUND","GOAL_COUNTDOWN","LEGACY","TEST_DIAGNOSTIC_FEEDBACK")
      out.put("noticeType",if(source.optString("type") in noticeTypes)source.optString("type") else if(status in noticeTypes)status else "DIAGNOSTIC")
      out.put("phase",when {
        status=="STARTED" -> "START"
        status=="DONE" -> "COMPLETE"
        status.contains("MERGE") -> "MERGE"
        status.contains("FAIL") || status.contains("ERROR") || status.contains("DENIED") -> "FAIL"
        status.contains("CANCEL") || status.contains("DISCARD") || status.contains("EXPIRE") || status.contains("INTERRUPT") -> "CANCEL"
        status.contains("QUEUED") || status=="PERSISTED_ACK" -> "QUEUE"
        source.optString("type") in listOf("VOICE_GENERATED","PACE_SNAPSHOT_SUBMITTED") || status=="GENERATED" -> "GENERATE"
        else -> "OBSERVE"
      })
      if(status=="DONE")out.put("completedAt",at)
      // Deliberately no message, coordinates, routes, arbitrary data or audio fields.
      for(name in listOf("scheduledAt","generatedAt","queuedAt","nativeQueuedAt","serviceReceivedAt","startedAt")) {
        val value=source.optDouble(name,Double.NaN)
        if(value.isFinite() && value>=0 && value<=9007199254740991.0)out.put(name,value.toLong())
      }
      for(name in listOf("scheduledAt","generatedAt","queuedAt","dispatchedAt","submittedAt","intervalStartAt","sourceAt","sampledAt","eventIndex","intervalIndex","lapIndex","intervalMinutes")) {
        val value=data.optDouble(name,Double.NaN)
        if(value.isFinite() && value>=0 && value<=9007199254740991.0)out.put(name,value.toLong())
      }
      for(name in listOf("reason","quality","clockReason"))code(data.optString(name))?.let{out.put(name,it)}
      data.optJSONObject("pacePeriodicSnapshot")?.let{p->
        for(name in listOf("slot","startAt","endAt")) {
          val value=p.optDouble(name,Double.NaN)
          if(value.isFinite() && value>=0 && value<=9007199254740991.0)out.put(name,value.toLong())
        }
        for(name in listOf("quality","reason"))code(p.optString(name))?.let{out.put(name,it)}
      }
      return out
    }
  }
  private data class State(var bytes:Long=0,var readable:Long=0,var records:Long=0,var dropped:Long=0,var reason:String="",var partial:Boolean=false,
    var owner:String="",var open:Boolean=false,var unclean:Boolean=false)
  private val states=mutableMapOf<String,State>()
  private var total=0L
  private var globalDropped=0L
  private val catalog=directory.listFiles()?.filter{it.name.endsWith(".meta.json")}?.map{it.name.removeSuffix(".meta.json")}?.toMutableSet() ?: mutableSetOf()
  private var lossMetadataFailure=false
  private fun atomicText(file:File,text:String) {
    val target=AtomicFile(file);var stream:java.io.FileOutputStream?=null;val bytes=text.toByteArray(Charsets.UTF_8)
    try {
      stream=target.startWrite();stream.write(bytes);stream.fd.sync();target.finishWrite(stream)
      check(target.openRead().use{it.readBytes().contentEquals(bytes)}){"TRACE_META_READBACK_FAILED"}
    }catch(e:Exception){target.failWrite(stream);throw e}
  }
  init {
    check(directory.isDirectory || directory.mkdirs());total=directory.listFiles()?.filter{it.name.endsWith(".ndjson")}?.sumOf{it.length()} ?: 0
    try{globalDropped=AtomicFile(File(directory,"global-loss.json")).openRead().bufferedReader().use{it.readText().toLong()}}catch(_:java.io.FileNotFoundException){}
  }
  fun globalLoss(count:Long) {
    val previous=globalDropped;globalDropped+=count
    try{atomicText(File(directory,"global-loss.json"),globalDropped.toString())}catch(e:Exception){globalDropped=previous;lossMetadataFailure=true;throw e}
  }
  private fun data(key:String)=File(directory,"$key.ndjson")
  private fun state(key:String):State = states.getOrPut(key) {
    val s=State();val file=data(key)
    if(file.exists()) {
      s.bytes=file.length()
      RandomAccessFile(file,"r").use{f->
        while(f.filePointer<f.length()) {
          val start=f.filePointer;val line=f.readLine() ?: break
          if(f.filePointer==f.length() && !fileHasNewline(f)) {s.partial=true;break}
          try { val item=JSONObject(line);check(item.getLong("seq")==s.records+1);s.records++;s.readable=f.filePointer }
          catch(_:Exception){s.partial=true;s.readable=start;break}
        }
      }
    }
    val meta=AtomicFile(File(directory,"$key.meta.json"))
    try{val old=JSONObject(meta.openRead().bufferedReader().use{it.readText()});s.dropped=old.optLong("dropped");s.reason=old.optString("stoppedReason")
      s.owner=old.optString("owner");s.open=old.optBoolean("open");s.unclean=old.optBoolean("unclean") || s.open && s.owner!=session
    }catch(_:java.io.FileNotFoundException){}
    if(s.partial)s.reason="INTERRUPTED_OR_INVALID_TAIL"
    s
  }
  private fun fileHasNewline(f:RandomAccessFile):Boolean {val end=f.filePointer;if(end==0L)return true;f.seek(end-1);val yes=f.read()==10;f.seek(end);return yes}
  private fun persistFlag(key:String,s:State) {
    atomicText(File(directory,"$key.meta.json"),JSONObject().put("dropped",s.dropped).put("stoppedReason",s.reason).put("owner",s.owner).put("open",s.open).put("unclean",s.unclean).toString())
  }
  fun loss(run:String,count:Long=1){
    if(run.isBlank())return
    val key=key(run)
    if(key !in catalog && catalog.size>=maxRuns){globalLoss(count);return}
    val s=state(key);val previous=s.dropped;s.dropped+=count
    try{persistFlag(key,s);catalog.add(key)}catch(e:Exception){s.dropped=previous;lossMetadataFailure=true;throw e}
  }
  fun append(payload:String,at:Long) {
    val item=compact(payload,at) ?: return;val key=item.getString("runId");val s=state(key)
    if(s.reason.isNotEmpty())return // Diagnostic stopped; no repeated full-disk I/O.
    if(key !in catalog && catalog.size>=maxRuns){s.reason="RUN_CATALOG_CAPACITY";s.dropped++;globalLoss(1);return}
    if(s.owner!=session || !s.open){s.owner=session;s.open=true;try{persistFlag(key,s)}catch(e:Exception){s.reason="META_WRITE_FAILED";s.dropped++;throw e}}
    catalog.add(key)
    item.put("seq",s.records+1)
    val bytes=(item.toString()+"\n").toByteArray(Charsets.UTF_8)
    if(bytes.size>2048 || s.bytes+bytes.size>perRunLimit || total+bytes.size>totalLimit) {
      s.reason=if(bytes.size>2048)"RECORD_LIMIT" else if(s.bytes+bytes.size>perRunLimit)"RUN_CAPACITY" else "GLOBAL_CAPACITY"
      s.dropped++;persistFlag(key,s);return
    }
    try {
      if(writeRecord!=null)writeRecord.invoke(data(key),bytes) else data(key).appendBytes(bytes)
      s.bytes+=bytes.size;s.readable=s.bytes;s.records++;total+=bytes.size
      if(item.optString("noticeType")=="RUN_GOAL_FINISHED" && item.optString("status")=="DONE"){
        RandomAccessFile(data(key),"rw").use{it.fd.sync()};s.open=false;persistFlag(key,s)
      }
    }
    catch(e:Exception){s.reason="WRITE_FAILED";s.dropped++;val actual=data(key).length();total+=actual-s.bytes;s.bytes=actual;s.partial=actual>s.readable;try{persistFlag(key,s)}catch(_:Exception){};throw e}
  }
  fun stats(run:String):String {
    require(run.length<=512){"INVALID_RUN_ID"}
    if(run.isBlank())return JSONObject().put("version",1).put("totalBytes",total).put("globalLimit",totalLimit).put("perRunLimit",perRunLimit).put("globalDropped",globalDropped).put("globalIncomplete",globalDropped>0 || lossMetadataFailure).put("lossMetadataFailure",lossMetadataFailure).toString()
    val key=key(run);val s=state(key)
    return JSONObject().put("version",1).put("runId",key).put("bytes",s.bytes).put("readableBytes",s.readable).put("records",s.records).put("dropped",s.dropped)
      .put("partialTail",s.partial).put("stoppedReason",if(s.reason.isNotEmpty())s.reason else if(s.records==0L)"NO_TRACE" else "").put("uncleanRestart",s.unclean).put("runEndObserved",s.owner.isNotEmpty() && !s.open)
      .put("incomplete",s.records==0L || s.dropped>0 || s.reason.isNotEmpty() || s.unclean || lossMetadataFailure).put("globalBytes",total)
      .put("perRunLimit",perRunLimit).put("globalLimit",totalLimit).put("maxRuns",maxRuns).put("globalDropped",globalDropped).put("globalIncomplete",globalDropped>0 || lossMetadataFailure).put("lossMetadataFailure",lossMetadataFailure).toString()
  }
  fun page(run:String,offset:Long,end:Long):String {
    require(run.isNotBlank() && run.length<=512){"INVALID_RUN_ID"}
    val key=key(run);val s=state(key);require(offset>=0 && end>=offset && end<=s.readable){"INVALID_SNAPSHOT_RANGE"}
    val entries=JSONArray();var next=offset
    if(end>0)RandomAccessFile(data(key),"r").use{f->
      if(offset>0){f.seek(offset-1);require(f.read()==10){"OFFSET_NOT_LINE_BOUNDARY"}}
      f.seek(end-1);require(f.read()==10){"END_NOT_LINE_BOUNDARY"};f.seek(offset)
      while(f.filePointer<end && entries.length()<64 && f.filePointer-offset<32768) {
        val line=f.readLine() ?: break;require(f.filePointer<=end){"INCOMPLETE_PAGE_RECORD"};entries.put(JSONObject(line));next=f.filePointer
      }
    }
    return JSONObject().put("entries",entries).put("nextOffset",next).put("done",next==end).put("snapshotBytes",end).toString()
  }
}
