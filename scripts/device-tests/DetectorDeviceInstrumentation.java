package app.runjourney.announcer;

import android.app.Instrumentation;
import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.lang.reflect.Method;
import java.util.UUID;
import javax.crypto.SecretKey;

/** Native-only instrumentation; targets the existing Test UID, not its JS/GPS path.
 * Uses the unchanged compiled PR73 storage classes. Emits aggregates only.
 */
public final class DetectorDeviceInstrumentation extends Instrumentation {
 private String mode;
 private final DetectorJournalStorage storage=DetectorJournalStorage.INSTANCE;
 @Override public void onCreate(Bundle args){super.onCreate(args);mode=args==null?"seal":args.getString("mode","seal");start();}
 private SecretKey key() throws Exception {
  Method method=DetectorJournalStorage.class.getDeclaredMethod("key");method.setAccessible(true);
  return (SecretKey)method.invoke(storage);
 }
 private String text(File f) throws Exception{return new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8);}
 private void meta(File root,String name,String value)throws Exception{Files.write(new File(root,name).toPath(),value.getBytes(StandardCharsets.UTF_8));}
 private String record(int seq,String kind,JSONObject data)throws Exception{return new JSONObject().put("seq",seq).put("kind",kind).put("data",data).toString();}
 private DetectorJournalStorage.Journal journal(File root,String id,SecretKey secret){return new DetectorJournalStorage.Journal(root,id,secret,DetectorJournalStorage.SEGMENT_BYTES,DetectorJournalStorage.SESSION_BYTES,DetectorJournalStorage.TOTAL_BYTES,false);}
 @Override public void onStart(){
  Bundle output=new Bundle();JSONObject result=new JSONObject();PowerManager.WakeLock lock=null;
  try{
   Context context=getTargetContext();if(!context.getPackageName().equals("app.runjourney.mobile.test"))throw new SecurityException();
   File root=new File(context.getNoBackupFilesDir(),"detector-device-native-probe-v1");if(!root.isDirectory()&&!root.mkdirs())throw new IllegalStateException();
   SecretKey secret=key();
   result.put("mode",mode).put("scope","native-only synthetic instrumentation; no JS/GPS/normal RUN acceptance").put("keyClass",secret.getClass().getSimpleName()).put("keyExportable",secret.getEncoded()!=null);
   if(mode.equals("reopen")){
    for(String name:new String[]{"sealed-id","crash-id"}){File idFile=new File(root,name);if(!idFile.isFile())continue;
     String id=text(idFile);File sourceRoot=name.equals("crash-id")?new File(context.getNoBackupFilesDir(),"detector-journal-v1"):root;
     JSONObject check=new JSONObject().put("state",text(new File(new File(sourceRoot,id),"status")).split(":")[0]);
     try{JSONObject page=new JSONObject(name.equals("crash-id")?storage.read(context,id,0):storage.readJournal$run_announcer_release(root,id,0,secret));check.put("storageComplete",page.getBoolean("storageComplete")).put("authenticatedRecords",page.getInt("authenticatedRecords"));}catch(Exception e){check.put("readRejected",true);}
     result.put(name,check);
    }
    result.put("nativeAcceptsAfterRestart",storage.offer(record(0,"PROBE_AFTER_RESTART",new JSONObject())));
   }else if(mode.equals("compare")){
    String id=UUID.randomUUID().toString();
    DetectorJournalStorage.Journal journal=new DetectorJournalStorage.Journal(root,id,secret,
      DetectorJournalStorage.SEGMENT_BYTES,DetectorJournalStorage.SESSION_BYTES,DetectorJournalStorage.TOTAL_BYTES,true);
    int count=385;
    for(int i=0;i<count;i++){
     String kind=i==0?"START":i==count-1?"END":new String[]{"INPUT","ADMISSION","OUTPUT","BATCH_END"}[i%4];
     JSONObject data=new JSONObject().put("synthetic",true).put("index",i).put("repeated","synthetic-state-window ".repeat(80));
     journal.append(record(i,kind,data),System.currentTimeMillis(),SystemClock.elapsedRealtime());
    }
    journal.seal();
    result.put("recordBytes",journal.recordBytes());
    String[] hashes=new String[2];
    for(int modeIndex=0;modeIndex<2;modeIndex++){
     boolean sequential=modeIndex==0;
     long began=SystemClock.elapsedRealtime(), firstPage=0,maxHeap=0;
     int offset=0,decryptions=0,pages=0;
     java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
     try(DetectorJournalStorage.Reader reader=sequential?new DetectorJournalStorage.Reader(root,id,secret):null){
      while(true){
       JSONObject page=sequential?reader.next():new JSONObject(storage.readJournal$run_announcer_release(root,id,offset,secret));
       if(++pages==1)firstPage=SystemClock.elapsedRealtime()-began;
       Runtime runtime=Runtime.getRuntime();
       maxHeap=Math.max(maxHeap,runtime.totalMemory()-runtime.freeMemory());
       int authenticated=page.getInt("authenticatedRecords");
       decryptions=sequential?authenticated:decryptions+authenticated;
       JSONArray rows=page.getJSONArray("records");
       for(int i=0;i<rows.length();i++)digest.update(rows.getString(i).getBytes(StandardCharsets.UTF_8));
       offset+=rows.length();
       if(page.getBoolean("done")){
        if(!page.getBoolean("storageComplete")||offset!=count)throw new IllegalStateException();
        break;
       }
       if(rows.length()==0)throw new IllegalStateException();
      }
     }
     hashes[modeIndex]=java.util.Arrays.toString(digest.digest());
     result.put(sequential?"cursor":"legacy",new JSONObject().put("firstPageMs",firstPage)
       .put("totalMs",SystemClock.elapsedRealtime()-began).put("decryptions",decryptions)
       .put("records",offset).put("pages",pages).put("maxSampledJvmHeapBytes",maxHeap));
    }
    boolean matched=hashes[0].equals(hashes[1]);result.put("matchedRecords",matched);
    if(!matched)throw new IllegalStateException();
   }else{
    String id=UUID.randomUUID().toString();DetectorJournalStorage.Journal j=journal(root,id,secret);
    if(mode.equals("seal")){
     j.append(record(0,"START",new JSONObject().put("synthetic",true)),System.currentTimeMillis(),SystemClock.elapsedRealtime());
     j.append(record(1,"END",new JSONObject().put("synthetic",true)),System.currentTimeMillis(),SystemClock.elapsedRealtime());j.seal();
     JSONObject page=new JSONObject(storage.readJournal$run_announcer_release(root,id,0,secret));
     result.put("storageComplete",page.getBoolean("storageComplete")).put("authenticatedRecords",page.getInt("authenticatedRecords")).put("decryptedStartMatches",new JSONObject(page.getJSONArray("records").getString(0)).getString("kind").equals("START"));meta(root,"sealed-id",id);
    }else if(mode.equals("failure")){
     String liveId=storage.open(context);File live=new File(new File(context.getNoBackupFilesDir(),"detector-journal-v1"),liveId);
     if(!new File(live,"0000.enc").mkdir())throw new IllegalStateException();
     boolean accepted=storage.offer(record(0,"START",new JSONObject().put("synthetic",true)));
     storage.stop();storage.list(context);
     result.put("offerAccepted",accepted).put("state",text(new File(live,"status"))).put("workerStats",new JSONObject(storage.stats(context)));
    }else if(mode.equals("paced")||mode.equals("crash")){
     lock=context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"RunJourney:NativeJournalProbe");lock.acquire(45000);
     if(mode.equals("crash")){id=storage.open(context);meta(root,"crash-id",id);boolean accepted=storage.offer(record(0,"START",new JSONObject().put("synthetic",true)));Bundle begun=new Bundle();begun.putString("phase","native-producer-active:"+accepted);sendStatus(1,begun);}
     int screenOff=0;long began=SystemClock.elapsedRealtime();int count=mode.equals("crash")?40:25;
     for(int i=0;i<count;i++){if(!context.getSystemService(PowerManager.class).isInteractive())screenOff++;
      String payload=record(mode.equals("crash")?i+1:i,"INPUT",new JSONObject().put("raws",new JSONArray().put(new JSONObject().put("synthetic",true))));
      if(mode.equals("crash")){if(!storage.offer(payload))throw new IllegalStateException();}else j.append(payload,System.currentTimeMillis(),SystemClock.elapsedRealtime());SystemClock.sleep(1000);
     }
     if(!mode.equals("crash")){j.append(record(count,"END",new JSONObject()),System.currentTimeMillis(),SystemClock.elapsedRealtime());j.seal();}
     JSONObject page=new JSONObject(storage.readJournal$run_announcer_release(root,id,0,secret));result.put("screenOffSamples",screenOff).put("samples",count).put("elapsedMs",SystemClock.elapsedRealtime()-began).put("storageComplete",page.getBoolean("storageComplete"));
    }else if(mode.equals("stress")){
     String blob=new String(new char[16384]).replace('\0','x');JournalTiming timing=new JournalTiming();int written=0;boolean capacity=false;long began=SystemClock.elapsedRealtime();
     for(int i=0;i<5700;i++){long at=SystemClock.elapsedRealtimeNanos();try{
       j.append(record(i,"INPUT",new JSONObject().put("raws",new JSONArray().put(new JSONObject().put("synthetic",true))).put("blob",blob)),System.currentTimeMillis(),SystemClock.elapsedRealtime());written++;
      }catch(Exception e){if(!"Capacity".equals(e.getMessage()))throw e;capacity=true;j.setFailed(true);break;}finally{timing.add((SystemClock.elapsedRealtimeNanos()-at)/1000000.0);}}
     j.seal();long bytes=0;for(File f:new File(root,id).listFiles())if(f.isFile())bytes+=f.length();
     long readAt=SystemClock.elapsedRealtime();JSONObject page=new JSONObject(storage.readJournal$run_announcer_release(root,id,0,secret));
     result.put("written",written).put("writtenInputs",j.getInputCount()).put("capacityRejected",capacity).put("bytes",bytes).put("writeElapsedMs",readAt-began).put("appendMs",timing.json()).put("firstPageReadMs",SystemClock.elapsedRealtime()-readAt).put("authenticatedRecords",page.getInt("authenticatedRecords")).put("storageComplete",page.getBoolean("storageComplete"));
    }else throw new IllegalArgumentException();
   }
   result.put("success",true);output.putString("summary",result.toString());finish(Activity.RESULT_OK,output);
  }catch(Throwable e){try{result.put("success",false).put("errorClass",e.getClass().getSimpleName());}catch(Exception ignored){}output.putString("summary",result.toString());finish(Activity.RESULT_CANCELED,output);
  }finally{if(lock!=null&&lock.isHeld())lock.release();}
 }
}
