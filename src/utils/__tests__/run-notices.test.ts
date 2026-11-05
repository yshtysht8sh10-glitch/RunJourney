import { startMessage, goalWarning, DEFAULT_GOAL_WARNING, validGoalWarning } from '@/domain/run-notices';
import type { ActiveRun } from '@/types/run';
const run = (): ActiveRun => ({id:'r',startedAt:new Date(0).toISOString(),createdAt:'',updatedAt:'',points:[],distanceMeters:0,features:{autoStop:true,break:false},finishGoal:{kind:'time',activeMs:120000}});
test('start speaks actual goal, auto-stop, auto-finish and clock including OFF/manual',()=>{
  expect(startMessage(run(),{enabled:true,minutes:10})).toContain('目標2分、自動終了ON、Auto Stop ON');
  const r=run();r.finishGoal={kind:'manual'};r.features!.autoStop=false;
  expect(startMessage(r,{enabled:false,minutes:5})).toContain('手動終了、目標指定なし、自動終了OFF、Auto Stop OFF');
  expect(startMessage(r,{enabled:false,minutes:5})).toContain('現在時刻案内はOFF');
  r.finishGoal={kind:'distance',meters:10000};r.finishAutoEnabled=false;
  expect(startMessage(r,{enabled:true,minutes:5})).toContain('目標10キロメートル、自動終了OFF');
});
test('time warning boundary, disabled finish and ended runs never announce late',()=>{
  expect(goalWarning(run(),DEFAULT_GOAL_WARNING,59999).reason).toBe('BEFORE_WARNING_THRESHOLD');
  expect(goalWarning(run(),DEFAULT_GOAL_WARNING,60000).message).toContain('残り60秒');
  expect(goalWarning(run(),DEFAULT_GOAL_WARNING,120000).reason).toBe('GOAL_ALREADY_REACHED');
  const r=run();r.finishAutoEnabled=false;expect(goalWarning(r,DEFAULT_GOAL_WARNING,90000).reason).toBe('DISABLED_OR_ENDED');
  r.finishAutoEnabled=true;r.endedAt=new Date(90000).toISOString();expect(goalWarning(r,DEFAULT_GOAL_WARNING,90000).reason).toBe('DISABLED_OR_ENDED');
  expect(validGoalWarning({distanceMeters:0,timeSeconds:60})).toBe(false);
});
test('distance warning uses accepted GPS edges rather than an arbitrary raw distance or jump',()=>{
  const r=run();r.finishGoal={kind:'distance',meters:1000};r.distanceMeters=990;
  expect(goalWarning(r,DEFAULT_GOAL_WARNING,10000).reason).toBe('BEFORE_WARNING_THRESHOLD');
  r.points=[{latitude:35,longitude:139,timestamp:0,accuracy:5},{latitude:36,longitude:139,timestamp:10000,accuracy:5}];
  expect(goalWarning(r,DEFAULT_GOAL_WARNING,10000).reason).toBe('BEFORE_WARNING_THRESHOLD');
});
