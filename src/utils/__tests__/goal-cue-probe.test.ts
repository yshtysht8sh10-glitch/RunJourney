import { Platform } from 'react-native';
import { runCueProbe } from '@/services/goal-cue-probe';
import native from '../../../modules/run-announcer';
import { database } from '@/repositories/database';
import { resetNative } from '@/test/native-driver';
jest.mock('expo-application',()=>({applicationId:'app.runjourney.mobile.test'}));
jest.mock('../../../modules/run-announcer',()=>({__esModule:true,default:{finishGoalCues:jest.fn(()=>true),notifyBatch:jest.fn(),appendDiagnostic:jest.fn(),stop:jest.fn(),diagnostics:jest.fn(()=>({running:false})),addListener:jest.fn(()=>({remove:jest.fn()})),previewFinishClock:jest.fn(),finishClock:jest.fn()}}));
jest.mock('expo-sqlite',()=>({openDatabaseAsync:async(name:string)=>{
 // Test-only independent native SQLite connection.
 // eslint-disable-next-line @typescript-eslint/no-require-imports
 if(name!==':memory:')return require('@/test/native-driver').connection;
 // eslint-disable-next-line @typescript-eslint/no-require-imports
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');
 return {execAsync:async(s:string)=>{db.exec(s);},runAsync:async(s:string,...p:unknown[])=>db.prepare(s).run(...p),getAllAsync:async(s:string,...p:unknown[])=>db.prepare(s).all(...p),closeAsync:async()=>db.close()};
}}));
let base=1800000000000;
beforeEach(()=>{base+=100000;resetNative();jest.clearAllMocks();jest.replaceProperty(Platform,'OS','android');jest.useFakeTimers();jest.setSystemTime(base);});
afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
async function settle(){for(let i=0;i<300;i++)await Promise.resolve();}
test.each(['distance','time'] as const)('foreground pulse %s uses shared durable evaluator without JS timers or user data changes',async kind=>{
 const db=await database(),before=await db.snapshot();const pending=runCueProbe(kind);await settle();
 expect(native.previewFinishClock).toHaveBeenCalledWith(30000);
 const pulse=jest.mocked(native.addListener!).mock.calls.at(-1)![1];
 // No jest.advanceTimers: emulate native service events while JS intervals do not fire.
 for(const elapsed of [3100,9100,15100,22100]){jest.setSystemTime(base+elapsed);pulse();await settle();}
 await pending;
 const ns=jest.mocked(native.notifyBatch!).mock.calls.flatMap(([s])=>JSON.parse(s).notices);
 expect(ns.map(n=>n.data.label)).toEqual(kind==='distance'?[200,190,10]:[60,50,10]);
 expect(ns.map(n=>n.chimePlayed)).toEqual([false,true,true]);
 expect(await db.snapshot()).toEqual(before);expect(native.finishGoalCues).toHaveBeenCalled();
 expect(native.finishClock).toHaveBeenLastCalledWith(false);
});
test('late native pulse skips crossed numbers rather than replaying the backlog',async()=>{
 const pending=runCueProbe('distance');await settle();const pulse=jest.mocked(native.addListener!).mock.calls.at(-1)![1];
 for(const elapsed of [15100,22100]){jest.setSystemTime(base+elapsed);pulse();await settle();}
 await pending;
 const ns=jest.mocked(native.notifyBatch!).mock.calls.flatMap(([s])=>JSON.parse(s).notices);
 expect(ns.map(n=>n.data.label)).toEqual([10]);
});
