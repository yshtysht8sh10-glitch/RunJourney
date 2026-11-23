import { parsePrivateInput, privateScenario, distribution, replayStatistics } from '@/test/gps-private-input';
test('synthetic truth includes 3/8/25/30-second stops and poor quality independently of GPS', () => {
  const scenario=privateScenario(180);
  expect(new Set(scenario.stops!.map(s=>(s.end-s.start)/1000))).toEqual(new Set([3,8,25,30]));
  expect(scenario.stops).toHaveLength(48);
  expect(parsePrivateInput(JSON.stringify(scenario)).batches).toHaveLength(scenario.batches.length);
  expect(scenario.batches.at(-1)!.receivedAt-scenario.startedAt).toBe(180*60000);
});
test('private parser uses bounded schema and fixed-code errors, never echoes input', () => {
  const s=privateScenario(1);
  expect(()=>parsePrivateInput('secret-coordinates')).toThrow('REPLAY_INVALID_JSON');
  expect(()=>parsePrivateInput(JSON.stringify({...s,schema:2}))).toThrow('REPLAY_INVALID_HEADER');
  s.batches[0].receivedAt=s.startedAt-1;
  expect(()=>parsePrivateInput(JSON.stringify(s))).toThrow('REPLAY_INVALID_BATCH');
  const t=privateScenario(1);t.batches[0].locations[0].coords.speed=undefined as unknown as null;
  expect(()=>parsePrivateInput(JSON.stringify(t))).toThrow('REPLAY_INVALID_FIX');
  const future=privateScenario(1);future.batches[0].locations[0].timestamp++;
  expect(()=>parsePrivateInput(JSON.stringify(future))).toThrow('REPLAY_INVALID_FIX');
});
test('no labels means no accuracy claim; timing uses available time rather than backdated onset', () => {
  expect(replayStatistics(undefined,[])).toEqual({truthProvided:false,accuracy:null});
  const result=replayStatistics([{start:1000,end:10000,quality:'good'},{start:30000,end:33000,quality:'poor'}],[
    {type:'STOP_CONFIRMED',effectiveAt:500,availableAt:6000},
    {type:'RESUME_CONFIRMED',effectiveAt:10000,availableAt:17000},
    {type:'STOP_CONFIRMED',effectiveAt:40000,availableAt:45000},
  ]);
  expect(result).toMatchObject({detectedStops:1,missedStops:1,unmatchedStops:1,stopDelayMs:{p50:5000},resumeDelayMs:{p95:7000}});
  expect(result).toMatchObject({byDurationSeconds:{'9':{intended:1,detected:1},'3':{intended:1,detected:0}}});
  expect(distribution([])).toEqual({count:0,p50:null,p95:null,max:null});
});
