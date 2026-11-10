import { runDetectorDeviceProbe } from '@/services/detector-device-probe';
import { journalDecode } from '@/domain/detector-journal';
import { DetectorJournal } from '@/services/detector-journal';
import { Platform } from 'react-native';
let mockRecords:string[]=[],mockSealed=false;
jest.mock('expo-application',()=>({applicationId:'app.runjourney.mobile.test'}));
jest.mock('@/repositories/run-repository',()=>({RunRepository:{getActiveRun:jest.fn(async()=>null)}}));
jest.mock('@/services/diagnostic-log',()=>({diagnosticLog:jest.fn()}));
jest.mock('../../../modules/run-announcer',()=>({__esModule:true,default:{
 diagnostics:()=>({running:false}),detectorJournalOpen:async()=>{mockRecords=[];mockSealed=false;return 'synthetic-session';},
 detectorJournalOffer:(s:string)=>{mockRecords.push(s);return true;},detectorJournalStop:()=>{mockSealed=true;},
 detectorJournalList:async()=>JSON.stringify([{id:'synthetic-session',bytes:mockRecords.reduce((n,r)=>n+r.length,0),sealState:mockSealed&&JSON.parse(mockRecords.at(-1)??'{}').kind==='END'?'SEALED':'INCOMPLETE'}]),
 detectorJournalRead:async(id:string,offset:number)=>JSON.stringify({records:mockRecords.slice(offset,offset+128),done:offset+128>=mockRecords.length,storageComplete:mockSealed&&JSON.parse(mockRecords.at(-1)??'{}').kind==='END'}),
 detectorJournalStats:()=>JSON.stringify({keyClass:'test-key-not-real-keystore'}),
}}));
beforeEach(()=>{jest.replaceProperty(Platform,'OS','android');DetectorJournal.stop();});
afterEach(()=>jest.restoreAllMocks());
test('synthetic device harness seals/replays shared observer without creating user RUNs',async()=>{
 const r=await runDetectorDeviceProbe('short','unit-test');expect(r.matchedBaseline).toBe(true);expect(r.processed).toBe(240);
 expect(r.replay).toMatchObject({complete:true,inputs:240,batches:240,mismatches:[]});expect(r.sealState).toBe('SEALED');
 expect(journalDecode(mockRecords[0]).data.coverage).toBe('JS_SUBMITTED_ONLY');
});
test('injected transport refusal keeps all synthetic GPS/detector steps matching baseline',async()=>{
 const r=await runDetectorDeviceProbe('failure','unit-test');expect(r.matchedBaseline).toBe(true);expect(r.processed).toBe(240);
 expect(r.recorderStatus).toBe('INCOMPLETE');expect(r.replay).toMatchObject({complete:false});expect(r.sealState).toBe('INCOMPLETE');
});
