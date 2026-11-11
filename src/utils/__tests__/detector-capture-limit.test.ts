import { DetectorJournalRecorder } from '@/services/detector-journal';
import { createDetectorDeviceRunner } from '@/services/detector-device-probe';
import { replayDetectorJournal, journalDecode } from '@/domain/detector-journal';
jest.mock('expo-application',()=>({applicationId:'app.runjourney.mobile.test'}));
test('capture deadline seals a complete batch while normal evaluation continues',async()=>{
 jest.useFakeTimers({now:1800000000000});
 const records:string[]=[];
 const stop=jest.fn();
 const recorder=new DetectorJournalRecorder({open:async()=>'',offer:p=>{records.push(p);return true;},stop},()=>true,95*60000);
 await recorder.arm('test');
 // Advance real elapsed time without invoking the normal RUN finish path.
 const runner=createDetectorDeviceRunner(recorder);
 jest.advanceTimersByTime(95*60000);
 runner.step();
 expect(stop).toHaveBeenCalledTimes(1);
 expect(recorder.recording).toBe(false);
 const count=records.length;
 for(let i=0;i<150;i++)runner.step();
 const result=runner.finish();
 expect(result.steps).toBe(151);
 expect(records).toHaveLength(count);
 const decoded=records.map(journalDecode);
 expect(decoded.at(-1).data.reason).toBe('DIAGNOSTIC_LIMIT_95_MINUTES');
 expect(decoded.at(-1).data.after.endedAt).toBeUndefined();
 expect(replayDetectorJournal(decoded)).toMatchObject({complete:true,inputs:1,mismatches:[]});
 jest.useRealTimers();
});
