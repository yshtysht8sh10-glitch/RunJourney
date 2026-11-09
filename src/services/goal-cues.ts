import { Platform } from 'react-native';
import type { ActiveRun } from '../types/run';
import { advanceCues,CUE_SETTINGS_KEY,DEFAULT_CUES,cueStateKey,cueLabel,validCueSettings,validCueState,type CueState,type CueSettings } from '../domain/goal-cues';
import { goalRevision } from '../domain/run-notices';
import { validFinishGoal } from '../domain/finish-goal';
import { effectiveDistance,stateOf,timeModel } from '../utils/run-model';
import { RunRepository } from '../repositories/run-repository';
import { database } from '../repositories/database';
import { GoalCueSettings } from '../repositories/goal-cue-settings';
import { diagnosticLog } from './diagnostic-log';
const native=()=>Platform.OS==='android'?
 // eslint-disable-next-line @typescript-eslint/no-require-imports
 require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default:null;
export function cueSample(run:ActiveRun,now:number){
 const g=run.finishGoal,valid=validFinishGoal(g)&&g.kind!=='manual';
 const kind=valid&&g.kind==='time'?'time' as const:'distance' as const;
 return {runId:run.id,revision:goalRevision(run),epoch:run.goalChanges?.length??0,kind,
  target:valid?(g.kind==='distance'?g.meters:g.activeMs/1000):0,
  progress:kind==='distance'?effectiveDistance(run):timeModel(run,now).activeRunningTime/1000,
  at:now,sourceAt:kind==='distance'?(run.points.at(-1)?.timestamp??Date.parse(run.startedAt)):now,
  running:stateOf(run)==='RUNNING',enabled:valid&&!run.endedAt&&run.finishAutoEnabled!==false};
}
export function cueContext(run:ActiveRun,settings:CueSettings,now:number){
 const s=cueSample(run,now),remaining=s.target-s.progress;
 return {at:now,version:settings.version,turnaround:settings.turnaround,countdown:settings.countdown,enabled:s.enabled,running:s.running,
  revision:s.revision,kind:s.kind,remaining,label:cueLabel(remaining),deadline: s.kind==='time'&&s.running?now+remaining*1000:0,
  suppressWarning:s.enabled&&settings.countdown&&remaining>0&&remaining<=(s.kind==='distance'?200:60)};
}
let pending:string|undefined,inFlight:Promise<void>|undefined;
const endedRuns=new Set<string>();
const nativeContexts=new Map<string,string>(),inactiveConfigs=new Map<string,number>();
const decisions=new Map<string,string>();
let previewing=false;
export const GoalCues={
 async preview(kind:'half-distance'|'half-time'|'countdown-distance'|'countdown-time') {
  if(previewing)throw Error('試聴が終了するまでお待ちください');
  if(await RunRepository.getActiveRun())throw Error('走行中はこのテストを使えません');
  if(previewing)throw Error('試聴が終了するまでお待ちください');
  const n=native();if(n?.diagnostics?.().running)throw Error('音声サービスが走行中です。終了を確認してください');
  previewing=true;
  const start=Date.now(),id='preview-cues-'+start,time=kind.endsWith('time'),countdown=kind.startsWith('countdown');
  const run:ActiveRun={id,startedAt:new Date(start).toISOString(),createdAt:'',updatedAt:'',points:[],distanceMeters:0,finishGoal:time?{kind:'time',activeMs:3600000}:{kind:'distance',meters:7000}};
  const settings={turnaround:true,countdown:true,version:1};
  const sample={runId:id,revision:goalRevision(run),epoch:0,kind:time?'time' as const:'distance' as const,target:time?3600:7000,progress:0,at:start,sourceAt:start,running:true,enabled:true};
  let state=advanceCues(null,sample,settings).state;
  const frames=countdown?(time?[60,50,10]:[200,190,10]):[sample.target/2];
  try {
   for(const label of frames){
    if(await RunRepository.getActiveRun())break;
    const now=Date.now(),progress=countdown?sample.target-label:label;
    const result=advanceCues(state,{...sample,progress,at:now,sourceAt:now},settings);state=result.state;
    for(const d of result.decisions)diagnosticLog('GOAL_CUE_DECISION',id+':'+d.reason,d.reason,{runId:id,simulation:true,labels:d.labels});
    const remaining=sample.target-progress;
    const context={at:now,version:1,turnaround:true,countdown:true,enabled:true,running:true,revision:sample.revision,kind:sample.kind,remaining,label:cueLabel(remaining),deadline:time?now+remaining*1000:0,suppressWarning:countdown};
    const notices=result.events.map(e=>{const key=id+':'+e.type+':'+e.label;diagnosticLog('VOICE_GENERATED',key,e.type,{runId:id,simulation:true,label:e.label});return {id:key,type:e.type,priority:60,message:e.message,chimePlayed:e.chime===false,generatedAt:now,expiresAt:now+(e.type==='GOAL_COUNTDOWN'?3000:8000),data:{runId:id,simulation:true,goalRevision:sample.revision,goalEpoch:0,cueVersion:1,label:e.label}};});
    await n?.notifyBatch?.(JSON.stringify({runId:id,state:'RUNNING',previewLeaseMs:label===frames[0]?30000:0,goalRevision:sample.revision,goalRevisionIndex:0,cueContext:context,notices}));
    await new Promise(resolve=>setTimeout(resolve,countdown?4000:9000));
   }
  } finally {previewing=false;if(!(await RunRepository.getActiveRun()))n?.stop();}
 },
 stop(id:string){endedRuns.add(id);if(pending===id)pending=undefined;},
 update(run:ActiveRun):Promise<void>{
  pending=run.id;
  if(!inFlight)inFlight=(async()=>{while(pending){const id=pending;pending=undefined;try{await evaluate(id);}catch(e){console.warn('Goal cues unavailable; recording and auto finish retained',e);}}})().finally(()=>{inFlight=undefined;});
  return inFlight;
 },
};
async function evaluate(id:string){
 if(endedRuns.has(id))return;
 const initialSettings=await GoalCueSettings.get();
 if(!initialSettings.turnaround&&!initialSettings.countdown&&(initialSettings.version===0||inactiveConfigs.get(id)===initialSettings.version))return;
 const run=await RunRepository.getActiveRun();if(!run||run.id!==id||run.endedAt)return;
 const db=await database();
 const reserved=await db.atomic(async store=>{
  const configText=await store.readSetting(CUE_SETTINGS_KEY),settings=configText?JSON.parse(configText):{...DEFAULT_CUES};
  if(!validCueSettings(settings))throw Error('Invalid goal cue configuration');
  const now=Date.now(),sample=cueSample(run,now);
  const text=await store.readSetting(cueStateKey(id));const previous:CueState|null=text?JSON.parse(text):null;
  if(previous&&!validCueState(previous))throw Error('Invalid goal cue ledger');
  const result=advanceCues(previous,sample,settings);
  if(result.changed)await store.writeSetting(cueStateKey(id),JSON.stringify(result.state));
  return {settings,sample,result};
 });
 const {settings,sample,result}=reserved;
 for(const event of result.events)diagnosticLog('GOAL_CUE_RESERVED',id+':'+event.type+':'+sample.revision+':'+event.label,event.type,{runId:id,revision:sample.revision,label:event.label,at:sample.at});
 for(const d of result.decisions){const key=id+':'+sample.revision+':'+d.reason,detail=JSON.stringify(d.labels??[]);if(decisions.get(key)!==detail){diagnosticLog('GOAL_CUE_DECISION',key,d.reason,{runId:id,revision:sample.revision,remaining:sample.target-sample.progress,labels:d.labels});decisions.set(key,detail);if(decisions.size>256)decisions.delete(decisions.keys().next().value!);}}
 const latest=await RunRepository.getActiveRun();if(!latest||latest.id!==id||latest.endedAt)return;
 const freshSettings=await GoalCueSettings.get();
 if(endedRuns.has(id))return;
 const now=Date.now(),context=cueContext(latest,freshSettings,now);
 const notices=(freshSettings.version===settings.version?result.events:[]).map(event=>{
  const eventId=id+':'+event.type+':'+sample.revision+':'+event.label;
  const ttl=event.type==='GOAL_COUNTDOWN'?3000:8000;
  const expiresAt=Math.min(sample.at+ttl,sample.kind==='distance'?sample.sourceAt+5000:context.deadline||Infinity);
  if(expiresAt<=now){diagnosticLog('GOAL_CUE_DECISION',eventId,'EXPIRED_BEFORE_DISPATCH',{runId:id,revision:sample.revision,label:event.label,expiresAt});return null;}
  diagnosticLog('VOICE_GENERATED',eventId,event.type,{runId:id,remaining:sample.target-sample.progress,expiresAt,revision:sample.revision,label:event.label});
  return {id:eventId,type:event.type,message:event.message,chimePlayed:event.chime===false,priority:60,generatedAt:sample.at,expiresAt,data:{runId:id,goalRevision:sample.revision,goalEpoch:sample.epoch,cueVersion:settings.version,label:event.label}};
 }).filter((n):n is NonNullable<typeof n>=>n!==null);
 const signature=JSON.stringify([context.revision,context.version,context.running,context.enabled,context.suppressWarning,context.countdown&&context.remaining<=(context.kind==='distance'?200:60)?context.label:null]);
 if(!notices.length&&nativeContexts.get(id)===signature)return;
 await native()?.notifyBatch?.(JSON.stringify({runId:id,state:stateOf(latest),paused:stateOf(latest)!=='RUNNING',ended:false,
  latestEventIndex:(latest.events?.length??0)-1,goalRevision:goalRevision(latest),goalRevisionIndex:latest.goalChanges?.length??0,cueContext:context,notices}));
 nativeContexts.set(id,signature);if(!freshSettings.turnaround&&!freshSettings.countdown)inactiveConfigs.set(id,freshSettings.version);
}
