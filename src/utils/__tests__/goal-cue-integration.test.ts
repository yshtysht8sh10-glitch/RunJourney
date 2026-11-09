import { VoiceAnnouncement } from '@/services/voice-announcement';
import { Platform } from 'react-native';
import native from '../../../modules/run-announcer';
import { GoalCues } from '@/services/goal-cues';
import { GoalCueSettings } from '@/repositories/goal-cue-settings';
import { CUE_SETTINGS_KEY,cueStateKey } from '@/domain/goal-cues';
import { RunRepository } from '@/repositories/run-repository';
import { database } from '@/repositories/database';
import { resetNative } from '@/test/native-driver';
import type { ActiveRun } from '@/types/run';
jest.mock('../../../modules/run-announcer',()=>({__esModule:true,default:{finishGoalCues:jest.fn(()=>true),notifyBatch:jest.fn(),appendDiagnostic:jest.fn(),stop:jest.fn(),diagnostics:jest.fn(()=>({running:false}))}}));
let serial=0;
const base=1800000000000;
const createRun=():ActiveRun=>({id:'cue-integration-'+serial++,startedAt:new Date(base).toISOString(),createdAt:'',updatedAt:'',points:[],distanceMeters:0,finishGoal:{kind:'time',activeMs:3600000},features:{autoStop:false,break:true}});
const notices=()=>jest.mocked(native.notifyBatch!).mock.calls.flatMap(([text])=>JSON.parse(text).notices);
beforeEach(()=>{resetNative();jest.clearAllMocks();jest.replaceProperty(Platform,'OS','android');jest.useFakeTimers();jest.setSystemTime(base);});
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test('defaults read without writes, two switches persist independently and same RUN/goal does not duplicate across reload',async()=>{
 const db=await database();expect(await GoalCueSettings.get()).toEqual({turnaround:false,countdown:false,version:0});expect((await db.snapshot()).settings[CUE_SETTINGS_KEY]).toBeUndefined();
 await GoalCueSettings.save({turnaround:true,countdown:false});expect(await GoalCueSettings.get()).toMatchObject({turnaround:true,countdown:false});
 await GoalCueSettings.save({turnaround:true,countdown:true});const run=createRun();await RunRepository.saveActiveRun(run);const before=(await db.snapshot()).draft;
 await GoalCues.update(run);jest.setSystemTime(base+1800000);await GoalCues.update(run);expect(notices().filter(e=>e.type==='TURNAROUND')).toHaveLength(1);
 await GoalCues.update(run);expect(notices().filter(e=>e.type==='TURNAROUND')).toHaveLength(1);
 expect((await db.snapshot()).draft).toEqual(before);expect((await db.snapshot()).settings[cueStateKey(run.id)]).toBeDefined();
 jest.setSystemTime(base+3540000);await GoalCues.update(run);expect(notices().filter(e=>e.type==='GOAL_COUNTDOWN').map(e=>e.data.label)).toEqual([60]);
 const persisted=JSON.parse((await db.snapshot()).settings[cueStateKey(run.id)]);expect(persisted.goals[JSON.stringify(['time',3600000,true])].floor).toBe(60);
 jest.doMock('@/repositories/database',()=>({database:async()=>db}));jest.doMock('@/repositories/run-repository',()=>({RunRepository}));jest.doMock('../../../modules/run-announcer',()=>({__esModule:true,default:native}));
 let reloaded!:typeof GoalCues;jest.isolateModules(()=>{reloaded=jest.requireActual('@/services/goal-cues').GoalCues;});await reloaded.update(run);expect(notices().filter(e=>e.type==='GOAL_COUNTDOWN')).toHaveLength(1);
 jest.dontMock('@/repositories/database');jest.dontMock('@/repositories/run-repository');
});
test('only reservation changes checkpoint; default OFF never starts audio service',async()=>{
 const run=createRun();await RunRepository.saveActiveRun(run);await GoalCues.update(run);expect(native.notifyBatch).not.toHaveBeenCalled();
 await GoalCueSettings.save({turnaround:true,countdown:true});await GoalCues.update(run);const db=await database(),before=(await db.snapshot()).settings[cueStateKey(run.id)];
 jest.setSystemTime(base+10000);await GoalCues.update(run);expect((await db.snapshot()).settings[cueStateKey(run.id)]).toEqual(before);
});
test('stop before pending I/O finishes prevents late cue dispatch',async()=>{
 await GoalCueSettings.save({turnaround:true,countdown:true});const run=createRun();await RunRepository.saveActiveRun(run);await GoalCues.update(run);jest.clearAllMocks();
 let release!:(x:ActiveRun|null)=>void;const get=jest.spyOn(RunRepository,'getActiveRun').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 jest.setSystemTime(base+1800000);const pending=GoalCues.update(run);for(let i=0;i<20&&!release;i++)await Promise.resolve();
 GoalCues.stop(run.id);expect(native.finishGoalCues).toHaveBeenCalledWith(run.id);release(run);await pending;expect(native.notifyBatch).not.toHaveBeenCalled();get.mockRestore();
});



test('time 60s warning is suppressed only while countdown ON in band; OFF keeps v26 warning',async()=>{
 const run=createRun();await RunRepository.saveActiveRun(run);await GoalCueSettings.save({turnaround:false,countdown:true});await GoalCues.update(run);
 jest.setSystemTime(base+3540000);await VoiceAnnouncement.beforeGoal(run);await GoalCues.update(run);
 expect(notices().filter(e=>e.type==='GOAL_WARNING')).toHaveLength(0);expect(notices().filter(e=>e.type==='GOAL_COUNTDOWN').map(e=>e.data.label)).toEqual([60]);
 await GoalCueSettings.save({turnaround:false,countdown:false});await VoiceAnnouncement.beforeGoal(run);await GoalCues.update(run);expect(notices().filter(e=>e.type==='GOAL_WARNING')).toHaveLength(1);
});


test('reservation delayed beyond TTL is logged and never dispatched or replayed',async()=>{
 const run=createRun();await RunRepository.saveActiveRun(run);await GoalCueSettings.save({turnaround:false,countdown:true});await GoalCues.update(run);jest.clearAllMocks();
 const actual=GoalCueSettings.get.bind(GoalCueSettings);let release!:(v:Awaited<ReturnType<typeof actual>>)=>void;
 jest.spyOn(GoalCueSettings,'get').mockImplementationOnce(actual).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 jest.setSystemTime(base+3540000);const p=GoalCues.update(run);for(let i=0;i<200&&!release;i++)await Promise.resolve();expect(release).toBeDefined();
 jest.setSystemTime(base+3544000);release(await actual());await p;expect(notices().filter(e=>e.type==='GOAL_COUNTDOWN')).toHaveLength(0);
 expect(jest.mocked(native.appendDiagnostic!).mock.calls.some(([text])=>JSON.parse(text).status==='EXPIRED_BEFORE_DISPATCH')).toBe(true);
 await GoalCues.update(run);expect(notices().filter(e=>e.type==='GOAL_COUNTDOWN')).toHaveLength(0);
});


test('preview is single-flight, uses bounded native lease, chimes once and never writes a RUN or settings',async()=>{
 const db=await database(),before=await db.snapshot();const first=GoalCues.preview('countdown-distance');
 await expect(GoalCues.preview('half-distance')).rejects.toThrow('試聴');await jest.advanceTimersByTimeAsync(13000);await first;
 const ns=notices();expect(ns.map(e=>e.data.label)).toEqual([200,190,10]);expect(ns.map(e=>e.chimePlayed)).toEqual([false,true,true]);
 const batches=jest.mocked(native.notifyBatch!).mock.calls.map(([s])=>JSON.parse(s));expect(batches.map(b=>b.previewLeaseMs)).toEqual([30000,0,0]);expect(native.stop).toHaveBeenCalledTimes(1);expect(await db.snapshot()).toEqual(before);
});

