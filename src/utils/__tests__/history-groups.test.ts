import { summarizeGroup, encodeHistoryGroups, mergeHistoryGroups, parseHistoryGroups, type GroupMember } from '@/domain/history-groups';
// Build explicit bounded summaries; grouping never needs an entire raw RUN.
function m(id:string,start:number,end:number,meters=0):GroupMember {
  return {summary:{kind:'run-summary',id,startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString(),distanceMeters:1000,originalDistanceMeters:1000,activeRunningTime:end-start,wallClockElapsed:end-start,pointCount:2,counts:{gps:2,events:0,metadata:0,operations:0,diagnostics:0}},
    first:{latitude:35+meters/111195,longitude:139,timestamp:start,accuracy:3,speed:2},last:{latitude:35+(meters+100)/111195,longitude:139,timestamp:end,accuracy:3,speed:2}};
}
test.each([299,300])('fixed %s-second adjacent gap can be grouped; original values and ranking exclude estimate',seconds=>{
  const a=m('a',0,100000),b=m('b',100000+seconds*1000,500000,200),before=JSON.stringify([a,b]);
  const result=summarizeGroup([b,a],true);
  expect(result.recordedDistanceMeters).toBe(2000);expect(result.estimatedDistanceMeters).toBeGreaterThan(90);
  expect(result.displayDistanceMeters).toBeGreaterThan(result.rankingDistanceMeters);
  expect(result.rankingDistanceMeters).toBe(2000);expect(JSON.stringify([a,b])).toBe(before);
});
test('301 seconds, overlap, and one invalid link in three are refused',()=>{
  expect(()=>summarizeGroup([m('a',0,100000),m('b',401000,500000)])).toThrow('300');
  expect(()=>summarizeGroup([m('a',0,100000),m('b',90000,500000)])).toThrow('300');
  expect(()=>summarizeGroup([m('a',0,100000),m('b',150000,200000),m('c',501000,600000)])).toThrow('300');
});
test('missing GPS, implausible speed and absent continuity confirmation remain unknown rather than zero',()=>{
  const a=m('a',0,100000),b=m('b',110000,200000,200);
  expect(summarizeGroup([a,b]).estimatedRunningMs).toBeNull();
  a.last=undefined;expect(summarizeGroup([a,b],true).estimatedDistanceMeters).toBeNull();
  a.last=m('x',0,100000).last;b.first!.latitude=40;expect(summarizeGroup([a,b],true).estimatedDistanceMeters).toBeNull();
});
test('group settings round-trip and conflict detection prevent double membership',()=>{
  const g={id:'g',memberIds:['a','b'],createdAt:new Date(0).toISOString()};
  const text=encodeHistoryGroups([g]);expect(parseHistoryGroups(mergeHistoryGroups(text,text))).toEqual([g]);
  expect(()=>mergeHistoryGroups(text,encodeHistoryGroups([{...g,id:'g2'}]))).toThrow('重複');
});

test('reject 445m over 31s before scaling to the one-second unrecorded gap',()=>{
 const a=m('a',0,100000),b=m('b',101000,200000);
 a.last={latitude:35,longitude:139,timestamp:85000,accuracy:1,speed:2};
 b.first={latitude:35+445/111195,longitude:139,timestamp:116000,accuracy:1,speed:2};
 const result=summarizeGroup([a,b],true);
 expect(result.gaps[0].reason).toBe('IMPLAUSIBLE_SPEED');
 expect(result.estimatedDistanceMeters).toBeNull();expect(result.estimatedRunningMs).toBeNull();
});

test.each([12.5,12.50001,2])('original observation speed %s m/s is checked before interpolation',speed=>{
 const a=m('a',0,100000),b=m('b',101000,200000);
 a.last={latitude:0,longitude:0,timestamp:85000,accuracy:1,speed:2};
 b.first={latitude:0,longitude:(speed*31/6371000)*180/Math.PI,timestamp:116000,accuracy:1,speed:2};
 const result=summarizeGroup([a,b],true);
 if(speed>12.5){expect(result.estimatedDistanceMeters).toBeNull();expect(result.estimatedRunningMs).toBeNull();}
 else {expect(result.estimatedDistanceMeters).toBeCloseTo(speed,7);}
});
test.each(['zero','reverse','accuracy'] as const)('invalid observation %s remains unknown',kind=>{
 const a=m('a',0,100000),b=m('b',100000,200000);
 a.last!.timestamp=100000;b.first!.timestamp=kind==='reverse'?99999:100000;
 if(kind==='accuracy')b.first!.accuracy=21;
 const r=summarizeGroup([a,b],true);expect(r.estimatedDistanceMeters).toBeNull();expect(r.estimatedRunningMs).toBeNull();
});
