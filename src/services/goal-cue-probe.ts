import * as SQLite from 'expo-sqlite';
import * as Application from 'expo-application';
import native from '../../modules/run-announcer';
import { SqliteStore } from '../repositories/sqlite-store';
import { CUE_SETTINGS_KEY } from '../domain/goal-cues';
import { RunRepository } from '../repositories/run-repository';
import { FinishClock } from './finish-clock';
import { evaluateCueSource, GoalCues } from './goal-cues';
import { diagnosticLog } from './diagnostic-log';
import type { ActiveRun } from '../types/run';

/** Synthetic samples; live RUN's native foreground pulse, cue evaluator and audio queue.
 * Separate in-memory SQLite, never the user's database. Does not test OS GPS delivery.
 */
export async function runCueProbe(kind:'distance'|'time') {
 if(Application.applicationId!=='app.runjourney.mobile.test')throw Error('Test版専用です');
 if(await RunRepository.getActiveRun() || native.diagnostics().running)throw Error('走行中は試聴できません');
 const sql=await SQLite.openDatabaseAsync(':memory:',{useNewConnection:true});
 const store=new SqliteStore(sql),settings={turnaround:false,countdown:true,version:1};
 const start=Date.now(),id='preview-cues-probe-'+start;
 let closed=false,active:ActiveRun|null=null;
 await store.atomic(s=>s.writeSetting(CUE_SETTINGS_KEY,JSON.stringify(settings)));
 const sample=(at:number):ActiveRun=>{
  const elapsed=at-start,remaining=elapsed<3000?210.2:elapsed<9000?199.8:elapsed<15000?189.8:9.8;
  const timeRemaining=elapsed<3000?70.2:elapsed<9000?59.8:elapsed<15000?49.8:9.8;
  const progress=7000-remaining,started=kind==='time'?at-(3600-timeRemaining)*1000:at-2000000;
  return {id,startedAt:new Date(started).toISOString(),createdAt:'',updatedAt:'',distanceMeters:progress,
   points:kind==='time'?[]:[{latitude:0,longitude:0,timestamp:started,accuracy:5},{latitude:progress/6371000*180/Math.PI,longitude:0,timestamp:at,accuracy:5}],
   finishGoal:kind==='time'?{kind:'time',activeMs:3600000}:{kind:'distance',meters:7000},finishAutoEnabled:true,features:{autoStop:false,break:true}};
 };
 try{
  active=sample(start);
  const source={run:async()=>await RunRepository.getActiveRun()?null:active,settings:async()=>settings,db:async()=>store,previewUntil:start+30000};
  await evaluateCueSource(id,source);
  await new Promise<void>((resolve,reject)=>{
   const finish=(error?:unknown)=>{if(closed)return;closed=true;active=null;GoalCues.stop(id);FinishClock.stop();native.stop();
    diagnosticLog('GOAL_CUE_PROBE',id,error?'FAILED':'FINISHED',{runId:id,simulation:true,source:'native-finish-clock',elapsedMs:Date.now()-start});
    if(error)reject(error);else resolve();};
   void (async()=>{
   if(await RunRepository.getActiveRun()){closed=true;active=null;GoalCues.stop(id);resolve();return;}
   try{FinishClock.start(async()=>{
    if(closed)return;
    if(await RunRepository.getActiveRun()){closed=true;active=null;GoalCues.stop(id);resolve();return;}
    const at=Date.now();
    if(at-start>=22000){finish();return;}
    active=sample(at);
    diagnosticLog('GOAL_CUE_PROBE',id+':'+at,'PULSE',{runId:id,simulation:true,source:'native-finish-clock',elapsedMs:at-start});
    try{await evaluateCueSource(id,source);}catch(e){finish(e);}
   },30000);}catch(e){finish(e);}
   })().catch(finish);
  });
 }finally{
  if(!closed){active=null;GoalCues.stop(id);if(!(await RunRepository.getActiveRun())){FinishClock.stop();native.stop();}}
  await sql.closeAsync();
 }
}
