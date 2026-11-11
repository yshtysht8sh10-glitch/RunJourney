import { AppState } from 'react-native';
import { DetectorJournalRecorder, DetectorJournal, detectorJournalAllowed, detectorJournalNative, replayLocalDetectorJournal } from './detector-journal';
import { RunRepository } from '../repositories/run-repository';
import { GpsObservationSession, type RawLocationObservation, type ObservationAdmission } from '../utils/gps-observation';
import { detectStop, effectiveDistance } from '../utils/run-model';
import { detectorSnapshot, journalEncode } from '../domain/detector-journal';
import { hashText } from '../domain/pages';
import { diagnosticLog } from './diagnostic-log';
import type { ActiveRun } from '../types/run';

let busy=false;
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const summary=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return {count:s.length,p50:s[Math.max(0,Math.ceil(s.length*.5)-1)]??null,p95:s[Math.max(0,Math.ceil(s.length*.95)-1)]??null,max:s.at(-1)??null};};
export function createDetectorDeviceRunner(recorder:DetectorJournalRecorder) {
 const start=1800000000000;
 let run:ActiveRun={id:'DEVICE-SYNTHETIC-NOT-A-RUN',startedAt:new Date(start).toISOString(),createdAt:'',updatedAt:'',points:[],events:[],distanceMeters:0,features:{autoStop:true,break:true},diagnostics:{entries:[],counts:{},processed:0}};
 const observations=new GpsObservationSession(undefined,undefined);recorder.begin(run);
 let meters=0;let steps=0;const costs:number[]=[];
 return {
  step(appState='active'){
   const before=performance.now(),i=steps++,speed=i%60>=30&&i%60<42?0:3.2;meters+=speed;
   const at=start+i*1000;
   const raws:RawLocationObservation[]=[{timestamp:at,receivedAt:at+15,latitude:meters/6371000*180/Math.PI,longitude:0,speed,accuracy:5}];
   recorder.input(run,raws,appState);const admissions:ObservationAdmission[]=[];
   const counts={...run.diagnostics!.counts};const incoming=observations.ingest(raws,counts,appState,start,recorder.recording?e=>admissions.push(e):undefined);
   if(recorder.recording)recorder.admission(admissions);
   run={...run,diagnostics:{...run.diagnostics!,counts}};
   const points=[];
   for(const input of incoming){run=detectStop(run,input.point,'live-observation',input.window);recorder.output(input,run);if(input.persist)points.push(input.point);}
   run={...run,points:[...run.points,...points]};run.distanceMeters=effectiveDistance(run);recorder.batchEnd(run);
   costs.push(performance.now()-before);
  },
  finish(){recorder.end({...run,endedAt:new Date(start+steps*1000).toISOString()});return {steps,processingMs:summary(costs),digest:hashText(journalEncode({state:detectorSnapshot(run),points:run.points,distanceMeters:run.distanceMeters})),transitions:run.events?.length??0,persistedPoints:run.points.length};}
 };
}

export async function runDetectorDeviceProbe(mode:'short'|'long'|'failure'|'paced'|'crash',build:string){
 if(busy)throw Error('検証中です');
 if(!detectorJournalAllowed()||await RunRepository.getActiveRun()||DetectorJournal.status==='ARMED'||DetectorJournal.recording)throw Error('Test版・通常RUNなし・診断OFFで実行してください');
 const native=detectorJournalNative();if(native.diagnostics().running)throw Error('音声サービスの終了を待ってください');
 busy=true;let openedId='',offResult:ReturnType<ReturnType<typeof createDetectorDeviceRunner>['finish']>|undefined;
 let offerCount=0,recorder:DetectorJournalRecorder|undefined,subscription:{remove():void}|undefined;
 let clock=false;
 const reportId='device-journal-'+Date.now();
 try{
  const total=mode==='long'?5700:mode==='paced'||mode==='crash'?25:240;
  const off=new DetectorJournalRecorder({open:async()=>'',offer:()=>true,stop:()=>undefined},()=>true);
  const baseline=createDetectorDeviceRunner(off);for(let i=0;i<total;i++)baseline.step(mode==='paced'?'background':'active');offResult=baseline.finish();
  recorder=new DetectorJournalRecorder({open:async()=>{openedId=await native.detectorJournalOpen!();return openedId;},offer:payload=>{
   offerCount++;if(mode==='failure'&&offerCount===25)return false;
   return native.detectorJournalOffer!(payload);
  },stop:()=>native.detectorJournalStop!()},()=>true);
  await recorder.arm(build);if(recorder.status!=='ARMED')throw Error('暗号鍵/記録開始に失敗');
  const on=createDetectorDeviceRunner(recorder),start=performance.now();let processed=0;let throttledMs=0;let firstFailureAtStep:number|undefined;let offPulses=0;let screenOffOn=0;let screenOffOff=0;const appStates:string[]=[];
  if(mode==='paced'||mode==='crash'){
   const pacedOff=createDetectorDeviceRunner(off);
   await new Promise<void>((resolve,reject)=>{
    let entering=false;const began=Date.now();
    subscription=native.addListener!('finishClock',()=>{
     if(entering)return;entering=true;
     void (async()=>{
      if(await RunRepository.getActiveRun())throw Error('通常RUNが開始されたため検証を停止');
      if(Date.now()-began>85000)throw Error('Native pulse timeout');
      const screenOff=native.detectorJournalDeviceScreen?.()===false;
      if(processed<total){
       const state=AppState.currentState??'unknown';appStates.push(state);on.step(state);processed++;if(screenOff)screenOffOn++;
       if(mode==='crash'&&processed>=total)resolve();
      }else{
       pacedOff.step(appStates[offPulses]);offPulses++;if(screenOff)screenOffOff++;
       if(offPulses>=total)resolve();
      }
     })().catch(reject).finally(()=>{entering=false;});
    });
    native.detectorJournalDeviceClock!();clock=true;
   });
   subscription?.remove();subscription=undefined;if(mode==='paced')offResult=pacedOff.finish();
  }else{
   for(let i=0;i<total;i++){
    on.step();processed++;if(firstFailureAtStep===undefined&&recorder.status==='INCOMPLETE')firstFailureAtStep=processed;
    if(i%16===15){if(await RunRepository.getActiveRun())throw Error('通常RUN開始');const waited=performance.now();await native.detectorJournalList!();throttledMs+=performance.now()-waited;await pause(0);}
   }
  }
  const onResult=on.finish();await native.detectorJournalList!();
  const elapsedMs=performance.now()-start;
  const sessions=JSON.parse(await native.detectorJournalList!()) as {id:string;bytes:number;sealState?:string}[];
  const session=sessions.find(s=>s.id===openedId);
  const stats=native.detectorJournalStats?JSON.parse(native.detectorJournalStats()):null;
  const replay=await replayLocalDetectorJournal(openedId);
  const legacyReplay=mode==='short'?await replayLocalDetectorJournal(openedId,true):undefined;
  const result={schema:1,mode,build,synthetic:true,scope:'observation-ingest/detector/recorder; no OS GPS, actual RUN/SQLite checkpoint or battery acceptance',processed,virtualMinutes:processed/60,elapsedMs,throttledMs,firstFailureAtStep,offPulses,screenOffOn,screenOffOff,
   off:offResult,on:onResult,matchedBaseline:offResult.digest===onResult.digest,handoffMs:recorder.handoffSummary,recorderStatus:recorder.status,bytes:session?.bytes,sealState:session?.sealState,
   estimatedBytesPerHour:session&&stats?.writtenInputs>0?session.bytes/stats.writtenInputs*3600:null,estimatedMinutesAt64MiB:session&&stats?.writtenInputs>0?64*1024*1024/(session.bytes/stats.writtenInputs)/60:null,stats,replay,legacyReplay};
  diagnosticLog('DETECTOR_DEVICE_PROBE',reportId,'RESULT',result);return result;
 }catch{
  diagnosticLog('DETECTOR_DEVICE_PROBE',reportId,'FAILED',{mode,build,synthetic:true,scope:'no raw payload or exception text'});throw Error('人工入力検証に失敗しました。通常RUNは変更していません。');
 }finally{subscription?.remove();recorder?.stop();if(clock&&!(await RunRepository.getActiveRun()))native.finishClock?.(false);busy=false;}
}

export async function verifyStoredDetectorDeviceProbes(){
 if(!detectorJournalAllowed()||await RunRepository.getActiveRun()||busy||DetectorJournal.recording)throw Error('診断OFF・通常RUNなしで確認してください');
 const native=detectorJournalNative(),sessions=JSON.parse(await native.detectorJournalList!()) as {id:string;bytes:number;sealState?:string}[];
 const rows=[];for(const s of sessions){if(s.bytes>8*1024*1024){rows.push({bytes:s.bytes,sealState:s.sealState,skipped:'LARGE_READER_COST'});continue;}try{rows.push({bytes:s.bytes,sealState:s.sealState,...await replayLocalDetectorJournal(s.id)});}catch{rows.push({bytes:s.bytes,sealState:s.sealState,complete:false,reason:'AUTHENTICATION_OR_READ_FAILED'});}}
 const result={syntheticScope:false,note:'Existing local sessions, no payload/coordinate output',rows};diagnosticLog('DETECTOR_DEVICE_PROBE','device-reopen-'+Date.now(),'REOPEN',result);return result;
}
