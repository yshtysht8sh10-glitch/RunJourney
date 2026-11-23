import {cueStateKey,advanceCues,DEFAULT_CUES,type CueState,type CueSample} from '@/domain/goal-cues';
const settings={...DEFAULT_CUES,turnaround:true,countdown:true};
const sample=(progress:number,kind:'distance'|'time'='distance',extra:Partial<CueSample>={}):CueSample=>({runId:'r',revision:'goal',epoch:0,kind,target:kind==='distance'?7000:3600,progress,at:100000,sourceAt:100000,running:true,enabled:true,...extra});
test.each(['distance','time'] as const)('%s announces every countdown threshold once, initial chime belongs to native session',kind=>{
 let state:CueState|null=null;const range=kind==='distance'?200:60,target=kind==='distance'?7000:3600,labels:number[]=[];
 for(let rem=target;rem>=0;rem-=kind==='distance'?10:10){const r=advanceCues(state,sample(target-rem,kind),settings);state=r.state;labels.push(...r.events.filter(e=>e.type==='GOAL_COUNTDOWN').map(e=>e.label));expect(advanceCues(state,sample(target-rem,kind),settings).events).toHaveLength(0);}
 expect(labels).toEqual(Array.from({length:range/10},(_,i)=>range-i*10));
});
test.each([['distance',3500,'3.5キロ'],['time',1800,'30分']] as const)('halfway %s crosses exactly once', (kind,half,text)=>{
 let r=advanceCues(null,sample(0,kind),settings);r=advanceCues(r.state,sample(half,kind),settings);expect(r.events.find(e=>e.type==='TURNAROUND')?.message).toContain(text);
 expect(advanceCues(r.state,sample(half-1,kind),settings).events).toHaveLength(0);expect(advanceCues(r.state,sample(half+1,kind),settings).events).toHaveLength(0);
});
test('jump selects latest crossed number, reverse/missing/abnormal input never replays',()=>{
 let r=advanceCues(null,sample(0),settings);r=advanceCues(r.state,sample(6790),settings);r=advanceCues(r.state,sample(6845),settings);
 expect(r.events.filter(e=>e.type==='GOAL_COUNTDOWN').map(e=>e.label)).toEqual([160]);expect(r.decisions).toContainEqual({reason:'COUNTDOWN_CROSSED_OLDER_SKIPPED',labels:[200,190,180,170]});
 expect(advanceCues(r.state,sample(6830),settings).events).toHaveLength(0);expect(advanceCues(r.state,sample(6845),settings).events).toHaveLength(0);
 for(const progress of [NaN,Infinity,-1])expect(advanceCues(r.state,sample(progress),settings).events).toHaveLength(0);
 expect(advanceCues(r.state,sample(6850,'distance',{sourceAt:90000}),settings).events).toHaveLength(0);
});
test('change already behind half and restore have no catchup; reverting consumed goal does not repeat',()=>{
 let r=advanceCues(null,sample(0),settings);r=advanceCues(r.state,sample(3500),settings);expect(r.events[0].type).toBe('TURNAROUND');
 r=advanceCues(r.state,sample(4000,'distance',{revision:'new',epoch:1,target:6000}),settings);expect(r.events).toHaveLength(0);
 r=advanceCues(JSON.parse(JSON.stringify(r.state)),sample(4000,'distance',{epoch:2}),settings);expect(r.events).toHaveLength(0);
});
test('pause consumes crossed levels without speaking and resume never catches up',()=>{
 let r=advanceCues(null,sample(0),settings);r=advanceCues(r.state,sample(6800,'distance',{running:false}),settings);expect(r.events).toHaveLength(0);
 expect(advanceCues(r.state,sample(6800),settings).events).toHaveLength(0);expect(advanceCues(r.state,sample(6810),settings).events.map(e=>e.label)).toEqual([190]);
});
test('switches independent and OFF to ON in band skips passed numbers',()=>{
 const off=advanceCues(null,sample(0),DEFAULT_CUES);expect(off.changed).toBe(false);expect(off.events).toHaveLength(0);
 let r=advanceCues(null,sample(0),{...settings,countdown:false});r=advanceCues(r.state,sample(3500),{...settings,countdown:false});expect(r.events[0].type).toBe('TURNAROUND');
 r=advanceCues(r.state,sample(6850),settings);expect(r.events).toHaveLength(0);expect(advanceCues(r.state,sample(6860),settings).events.map(e=>e.label)).toEqual([140]);
});
test('at goal, disabled auto finish, initial recovery inside band, or stale fixes do not speak',()=>{
 const r=advanceCues(null,sample(0),settings);for(const s of [sample(7000),sample(7001),sample(6800,'distance',{enabled:false})])expect(advanceCues(r.state,s,settings).events).toHaveLength(0);
 expect(advanceCues(null,sample(6900),settings).events).toHaveLength(0);
});

test('long imported RUN identifiers still produce bounded collision-resistant setting keys',()=>{
 expect(cueStateKey('x'.repeat(256)).length).toBeLessThan(256);expect(cueStateKey('x'.repeat(255)+'y')).not.toBe(cueStateKey('x'.repeat(256)));
});


test('countdown chime reservation is durable and not repeated after restore or quick settings changes',()=>{
 let r=advanceCues(null,sample(0),settings);r=advanceCues(r.state,sample(6800),settings);expect(r.events.find(e=>e.type==='GOAL_COUNTDOWN')?.chime).toBe(true);
 r=advanceCues(JSON.parse(JSON.stringify(r.state)),sample(6810),settings);expect(r.events.find(e=>e.type==='GOAL_COUNTDOWN')?.chime).toBe(false);
 r=advanceCues(r.state,sample(6850),{...settings,version:2});expect(r.events).toHaveLength(0);
 r=advanceCues(r.state,sample(6860),{...settings,version:2});expect(r.events.find(e=>e.type==='GOAL_COUNTDOWN')?.chime).toBe(false);
});
