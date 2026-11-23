import { pacePeriodicSnapshots } from '@/domain/pace-periodic';
import { createPaceWorkout,DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import type { ActiveRun } from '@/types/run';
const start=1800000000000;
function make(delay=0,poor=false):ActiveRun {
  return {id:'quality-repro',startedAt:new Date(start).toISOString(),createdAt:'',updatedAt:'',distanceMeters:0,features:{autoStop:false,break:true},events:[],
    paceWorkout:createPaceWorkout({...DEFAULT_PACE_SETTINGS,enabled:true,voice:true,voiceIntervalSec:60},start),
    points:Array.from({length:121},(_,i)=>({timestamp:start+i*5000,latitude:35+i*15/111195,longitude:139,accuracy:poor&&i===18?60:5,speed:3})).filter(p=>p.timestamp>=start+delay)};
}
test.each([['clean',0,false],['startup15s',15000,false],['one-poor-fix',0,true]] as const)('numeric cumulative survives %s',(name,delay,poor)=>{
  const snapshots=pacePeriodicSnapshots(make(delay,poor),start+600000,{acceptedThrough:0,activeFromMs:start});
  expect(snapshots).toHaveLength(10);
  expect(snapshots.every(s=>s.cumulativeNumeric&&s.intervalNumeric)).toBe(true);
  if(poor){expect(snapshots[1].intervalQuality).toBe('ESTIMATED');expect(snapshots[2].intervalQuality).toBe('MEASURED');}
});
test.each([false,true])('20-second delivery lag uses measured distance, not invented motion (autoStop=%s)',autoStop=>{
  const run=make();run.points=run.points.filter(p=>p.timestamp<=start+55000);
  run.features!.autoStop=autoStop;
  const first=pacePeriodicSnapshots(run,start+75000,{acceptedThrough:0,activeFromMs:start})[0];
  expect(first).toMatchObject({quality:'READY',cumulativeNumeric:true,cumulativeQuality:'ESTIMATED'});
  expect(first.distanceMeters).toBeCloseTo(165,1);
  expect(first.message).toContain('約');
});

test('50m distance eligibility is shared with normal laps; bad fixes never add fabricated edges',()=>{
  const r=make();r.points.forEach(p=>p.accuracy=40);
  const result=pacePeriodicSnapshots(r,start+600000,{acceptedThrough:0,activeFromMs:start});
  expect(result.every(s=>s.cumulativeNumeric&&s.intervalNumeric)).toBe(true);
  expect(result.at(-1)!.distanceMeters).toBeCloseTo(1800,1);
  r.points[18].accuracy=60;
  const after=pacePeriodicSnapshots(r,start+600000,{acceptedThrough:0,activeFromMs:start});
  expect(after.at(-1)!.distanceMeters).toBeCloseTo(1770,1);
});

test('long GPS loss announces the last valid time, keeps cumulative and recovers',()=>{
  const r=make();const all=r.points;r.points=all.filter(p=>p.timestamp<=start+60000);
  const result=pacePeriodicSnapshots(r,start+195000,{acceptedThrough:1,activeFromMs:start});
  expect(result[0]).toMatchObject({intervalNumeric:false,cumulativeNumeric:true,cumulativeQuality:'STALE',asOfAt:start+60000});
  expect(result[0].message).toContain('実走1分');
  expect(result[0].message).toContain('直近区間はデータ不足');
  expect(result[0].distanceMeters).toBeCloseTo(180,1);
  r.points=all.filter(p=>p.timestamp<=start+60000||p.timestamp>=start+240000);
  const recovered=pacePeriodicSnapshots(r,start+360000,{acceptedThrough:4,activeFromMs:start})[0];
  expect(recovered).toMatchObject({cumulativeNumeric:true,intervalNumeric:true,intervalQuality:'MEASURED'});
});

test('no real evidence produces exceptional unknown; future fixes cannot manufacture evidence',()=>{
  const r=make();r.points=r.points.filter(p=>p.timestamp>start+60000);
  const s=pacePeriodicSnapshots(r,start+75000,{acceptedThrough:0,activeFromMs:start})[0];
  expect(s).toMatchObject({cumulativeNumeric:false,quality:'DATA_INSUFFICIENT'});
  expect(s.message).toContain('累計は不明');
});

test('a later outage never rolls a properly bracketed earlier boundary backwards',()=>{
  const r=make();r.points=r.points.filter(p=>p.timestamp<=start+65000);
  const cursor={acceptedThrough:0,activeFromMs:start};
  const timely=pacePeriodicSnapshots(r,start+75000,cursor)[0];
  const late=pacePeriodicSnapshots(r,start+180000,cursor);
  expect(late[0]).toEqual(timely);
  expect(late[2]).toMatchObject({asOfAt:start+65000,cumulativeQuality:'STALE',cumulativeNumeric:true});
});
