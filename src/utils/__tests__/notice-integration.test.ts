import {createPaceWorkout,DEFAULT_PACE_SETTINGS,validPaceState,safePaceMetadata} from '@/domain/pace-workout';
import {voiceSnapshot,recoveryGuidance} from '@/domain/voice-guidance';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { RunService } from '@/services/run-service';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { RunRepository } from '@/repositories/run-repository';
import { FinishSettings } from '@/repositories/finish-settings';
import { ClockSettingsRepository } from '@/repositories/clock-settings';
import { GoalWarningSettingsRepository } from '@/repositories/goal-warning-settings';
import { RunSettings } from '@/repositories/run-settings';
import { FinishClock } from '@/services/finish-clock';
import { resetNative } from '@/test/native-driver';
import native from '../../../modules/run-announcer';
jest.mock('@/tasks/location-task',()=>({LOCATION_TASK_NAME:'test'}));
jest.mock('@/utils/build',()=>({isStandaloneTest:()=>true}));
jest.mock('expo-task-manager',()=>({isAvailableAsync:async()=>true}));
jest.mock('expo-crypto',()=>({randomUUID:()=>jest.requireActual('node:crypto').randomUUID()}));
jest.mock('expo-location',()=>({Accuracy:{High:4},ActivityType:{Fitness:3},PermissionStatus:{GRANTED:'granted'},hasServicesEnabledAsync:async()=>true,isBackgroundLocationAvailableAsync:async()=>true,requestForegroundPermissionsAsync:async()=>({status:'granted'}),requestBackgroundPermissionsAsync:async()=>({status:'granted'}),hasStartedLocationUpdatesAsync:async()=>true,startLocationUpdatesAsync:jest.fn(),stopLocationUpdatesAsync:jest.fn()}));
jest.mock('../../../modules/run-announcer',()=>({__esModule:true,default:{notifyBatch:jest.fn(),start:jest.fn(),stop:jest.fn(),updateClock:jest.fn(),updateDistance:jest.fn(),finishClock:jest.fn()}}));
const notices=()=>jest.mocked(native.notifyBatch!).mock.calls.flatMap(([text])=>JSON.parse(text).notices);
beforeEach(async()=>{resetNative();await RunRepository.clearActiveRun();jest.clearAllMocks();jest.useFakeTimers();jest.setSystemTime(1800000000000);jest.replaceProperty(Platform,'OS','android');await ClockSettingsRepository.save({enabled:true,minutes:10});await FinishSettings.save({kind:'time',activeMs:120000});await RunSettings.save({autoStop:true,break:false});});
afterEach(()=>{FinishClock.stop();jest.useRealTimers();jest.restoreAllMocks();});
test('double START shares a durable RUN and emits one applied-settings event',async()=>{
  const a=RunService.startRun(),b=RunService.startRun();expect(a).toBe(b);
  const run=await a;
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(notices().filter(n=>n.type==='RUN_STARTED')).toHaveLength(1);
  expect(notices().find(n=>n.type==='RUN_STARTED').message).toContain('目標2分、自動終了ON、Auto Stop ON');
  expect(run.startClockSettings).toEqual({enabled:true,minutes:10});
  await ClockSettingsRepository.save({enabled:false,minutes:5});
  expect(run.startClockSettings).toEqual({enabled:true,minutes:10});
});
test('warning is once per goal and delayed preference read cannot resurrect an old target',async()=>{
  const run=await RunService.startRun();jest.setSystemTime(Date.parse(run.startedAt)+60000);
  await VoiceAnnouncement.beforeGoal(run);await VoiceAnnouncement.beforeGoal(run);
  expect(notices().filter(n=>n.type==='GOAL_WARNING')).toHaveLength(1);
  const next=await RunRepository.updateFinishGoal(run.id,{kind:'time',activeMs:240000},true);
  let resolve!:(value:{distanceMeters:number;timeSeconds:number})=>void;
  jest.spyOn(GoalWarningSettingsRepository,'get').mockReturnValueOnce(new Promise(r=>{resolve=r;}));
  const waiting=VoiceAnnouncement.beforeGoal(next);
  await RunRepository.updateFinishGoal(run.id,{kind:'time',activeMs:300000},true);
  resolve({distanceMeters:500,timeSeconds:60});await waiting;
  expect(notices().filter(n=>n.type==='GOAL_WARNING')).toHaveLength(1);
});
test('warning I/O never delays goal checking',async()=>{
  const run=await RunService.startRun();
  jest.spyOn(VoiceAnnouncement,'beforeGoal').mockReturnValueOnce(new Promise(()=>undefined));
  await expect(RunService.checkGoal(run)).resolves.toBeNull();
});

test('GPS startup failure never announces success; retry keeps the same RUN and announces after tracking succeeds',async()=>{
  jest.mocked(Location.startLocationUpdatesAsync).mockRejectedValueOnce(Error('GPS unavailable'));
  await expect(RunService.startRun()).rejects.toThrow('GPS unavailable');
  const saved=await RunRepository.getActiveRun();expect(saved).not.toBeNull();
  expect(notices().filter(n=>n.type==='RUN_STARTED')).toHaveLength(0);
  const retry=await RunService.startRun();expect(retry.id).toBe(saved!.id);
  expect(notices().filter(n=>n.type==='RUN_STARTED')).toHaveLength(1);
});
test('auto-finish OFF immediately invalidates the queued goal revision',async()=>{
  const run=await RunService.startRun();jest.setSystemTime(Date.parse(run.startedAt)+60000);
  await VoiceAnnouncement.beforeGoal(run);
  const updated=await RunService.updateFinishGoal(run.id,{kind:'time',activeMs:120000},false);
  expect(updated.finishAutoEnabled).toBe(false);
  const batches=jest.mocked(native.notifyBatch!).mock.calls.map(([text])=>JSON.parse(text));
  expect(batches.some(b=>b.goalRevisionIndex===1&&b.goalRevision.includes('false')&&b.notices.length===0)).toBe(true);
  await VoiceAnnouncement.beforeGoal(updated);
  expect(notices().filter(n=>n.type==='GOAL_WARNING')).toHaveLength(1);
});

test('multi-segment lap uses actual dispatch and recovery operands without enabling multi-segment controller',async()=>{


 const started=Date.now()-351000;
 const run={id:'multi-dispatch',startedAt:new Date(started).toISOString(),createdAt:'',updatedAt:'',distanceMeters:1001,
 points:Array.from({length:72},(_,i)=>({timestamp:started+i*350000/71,latitude:35+i*1001/71/111195,longitude:139,accuracy:3,speed:3})),
 paceWorkout:createPaceWorkout({...DEFAULT_PACE_SETTINGS,enabled:true,voice:true},started)};
 run.paceWorkout!.workout.segments=[{id:'a',kind:'steady',targetPaceSecPerKm:300,toleranceSecPerKm:10,target:{type:'distance',meters:500}},{id:'b',kind:'steady',targetPaceSecPerKm:400,toleranceSecPerKm:10,target:{type:'distance',meters:1000}}];
 expect(validPaceState(run.paceWorkout)).toBe(false);expect(safePaceMetadata(run.paceWorkout)).toEqual(run.paceWorkout);
 await VoiceAnnouncement.updateRun(run);
 const km=notices().find(n=>n.type==='KILOMETER_LAP');expect(km).toBeDefined();expect(km.data.targetLapSeconds).toBe(350);expect(km.message).toContain('今回のラップは目標');
 const snapshot=voiceSnapshot(run,Date.now());expect(snapshot.targetCumulativeSeconds).toBeCloseTo(350.4);expect(snapshot.cumulativeSavingsSec).toBeCloseTo(-.6);
 expect(recoveryGuidance(run,Date.now()).data.cumulativeSavingsSec).toBeCloseTo(-.6);
});
