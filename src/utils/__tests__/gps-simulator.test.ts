import fs from 'node:fs';
import native from '../../../modules/run-announcer';
import { GpsSimulator } from '@/test/gps-simulator';
import { ingestLocationBatch } from '@/tasks/location-task';
import { RunRepository } from '@/repositories/run-repository';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { database } from '@/repositories/database';
import { ActiveRun } from '@/types/run';
import { Platform } from 'react-native';
import { diagnosticLog } from '@/services/diagnostic-log';
import { summarizeStopLatency } from '@/domain/stop-latency';
import { resetNative } from '@/test/native-driver';
jest.mock('@/utils/build', () => ({ isStandaloneTest: () => true }));
jest.mock('@/services/diagnostic-log', () => ({ diagnosticLog: jest.fn() }));
jest.mock('../../../modules/run-announcer', () => ({ __esModule:true,default:{ notifyBatch:jest.fn(),updateDistance:jest.fn(),stop:jest.fn() } }));
test('95 minute seeded stream uses the device adapter, real repository/detector/SQL and voice generation, with 6s disk stalls', async()=>{
  resetNative(); jest.replaceProperty(Platform,'OS','android');
  const sim = new GpsSimulator(Number(process.env.RUNJOURNEY_SIM_SEED ?? 49));
  jest.spyOn(Date,'now').mockImplementation(()=>sim.now);
  const db = await database(), originalSave = db.saveDraft.bind(db);
  await db.setSetting('@runjourney/voice-announcement/v1','on');
  const r:ActiveRun={id:'SIMULATION-ONLY-'+sim.seed,startedAt:new Date(sim.now).toISOString(),createdAt:'',updatedAt:'',points:[],events:[],distanceMeters:0,features:{autoStop:true,break:true},diagnostics:{entries:[],counts:{},processed:0},paceWorkout:createPaceWorkout({...DEFAULT_PACE_SETTINGS,enabled:true,distanceKm:200,voice:true,voiceIntervalSec:60},sim.now)};
  await RunRepository.saveActiveRun(r);
  let held: {at:number;release:()=>void}[]=[];
  jest.spyOn(db,'saveDraft').mockImplementation(async value=>{await new Promise<void>(release=>{held.push({at:sim.now+6000,release});});await originalSave(value);});
  const events: {id:string;type:string;status:string;at:number}[]=[];
  jest.mocked(native.notifyBatch!).mockImplementation(payload=>{
    const batch=JSON.parse(payload); for(const n of batch.notices) events.push({id:n.id,type:n.type,status:n.expiresAt < sim.now?'EXPIRED':'ACCEPTED_BY_FAKE_AUDIO',at:sim.now});
  });
  const cpuStart=performance.now();
  for(let sec=0;sec<=95*60;sec++){
    const batch=sim.step();
    const due=held.filter(h=>h.at<=sim.now);held=held.filter(h=>h.at>sim.now);due.forEach(h=>h.release());
    if(batch.length)await ingestLocationBatch(batch,sim.now,sec%900<30?'active':'background');
  }
  // Release storage until the latest cumulative snapshot is durable, then STOP.
  let flushed=false; const barrier=RunRepository.flushCheckpoint().then(()=>{flushed=true;});
  for(let i=0;!flushed&&i<10000;i++){held.splice(0).forEach(h=>h.release());await Promise.resolve();}
  await barrier;
  jest.mocked(db.saveDraft).mockRestore();
  const saved=await RunRepository.finishActiveRun(new Date(sim.now).toISOString());
  expect(saved).not.toBeNull();expect(saved!.points.length).toBeGreaterThan(1000);
  expect((await db.list(true)).map(r=>r.id)).toEqual([r.id]);
  const rows=jest.mocked(diagnosticLog).mock.calls.map(([type,id,status,data])=>({type,id,status,data:data as Record<string,unknown>,loggedAt:0}));
  const summary=summarizeStopLatency(rows,r.id);
  expect(summary.stages.repositoryQueueMs.max).toBeLessThanOrEqual(1);
  const transitions=rows.filter(e=>e.type==='STOP_PIPELINE'&&['STOP_CONFIRMED','RESUME_CONFIRMED'].includes(e.status));
  expect(transitions.length).toBeGreaterThanOrEqual(12);
  const stopTruthDelays = transitions.filter(e=>e.status==='STOP_CONFIRMED').map(e=>{
    const pipeline=e.data.pipeline as {sampleAt:number;finishedAt:number};
    const truth=sim.timeline.findLast(t=>t.at<=pipeline.sampleAt)!;
    expect(truth.kind).toBe('STOP');
    const delay=pipeline.finishedAt-truth.at;expect(delay).toBeLessThanOrEqual(10000);return delay;
  });
  const expired=events.filter(e=>e.status==='EXPIRED');expect(expired).toHaveLength(0);
  const pace=events.filter(e=>e.type==='PACE_WARNING');expect(pace.length).toBeGreaterThan(50);
  expect(pace.at(-1)!.at-sim.startedAt).toBeGreaterThan(90*60000);
  const report={schema:1,seed:sim.seed,virtualMinutes:95,realMs:performance.now()-cpuStart,historyIsolation:'PC in-memory SQLite only; no native GPS/audio or app database',stages:summary.stages,transitionCount:transitions.length,stopTruthDelays,voiceEventCount:events.length,paceEventCount:pace.length,expiredCount:expired.length,truth:sim.timeline,events,limitations:['Fake audio acceptance is not native TTS completion or audible proof.','Virtual queue statistics exclude OS delivery and real CPU scheduling.','6s minimum storage stall plus cooperative virtual scheduling is injected; completion can take more virtual seconds. Next RUN must validate device improvement.']};
  if(process.env.RUNJOURNEY_SIM_REPORT)fs.writeFileSync(process.env.RUNJOURNEY_SIM_REPORT,JSON.stringify(report,null,2),{flag:'wx'});
  await RunRepository.clearActiveRun();jest.restoreAllMocks();
},180000);
test('seed reproduces batching, pauses without clock advance and resumes by step',()=>{
  const a=new GpsSimulator(123),b=new GpsSimulator(123);
  for(let i=0;i<1000;i++)expect(a.step()).toEqual(b.step());
  const time=a.now;a.paused=true;expect(a.step()).toEqual([]);expect(a.now).toBe(time);a.paused=false;a.step();expect(a.now).toBe(time+1000);
});
