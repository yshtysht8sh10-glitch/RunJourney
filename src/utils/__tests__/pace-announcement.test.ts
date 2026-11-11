import { paceAnnouncementMessage, type PaceAnnouncementSample } from '@/domain/pace-workout';
const sample: PaceAnnouncementSample = { runId:'run', at:120000, savings:36, meters:8300, target:360 };
const previous = { ...sample, at:60000, savings:31 };
test('increase, distance and cumulative savings are spoken in order',()=>{
 expect(paceAnnouncementMessage(sample,previous)).toBe('この1分で5秒貯金が増えました。8.3キロを通過。ここまでの走行で貯金は36秒です。');
});
test('positive cumulative savings can decrease over the latest interval',()=>{
 expect(paceAnnouncementMessage(sample,{...previous,savings:41})).toContain('5秒貯金が減りました。8.3キロを通過。ここまでの走行で貯金は36秒');
});
test('unchanged savings and actual two-minute interval',()=>{
 expect(paceAnnouncementMessage({...sample,at:180000}, {...previous,savings:36})).toContain('この2分で貯金の増減はありません');
});
test('negative cumulative savings use delay while improvement remains positive',()=>{
 expect(paceAnnouncementMessage({...sample,savings:-36},{...previous,savings:-41})).toContain('5秒貯金が増えました。8.3キロを通過。ここまでの走行で遅れは36秒');
});
test('first, other RUN, changed target and invalid prior samples omit interval change',()=>{
 for(const prior of [undefined,{...previous,runId:'other'},{...previous,target:400},{...previous,savings:NaN},{...previous,at:120000}])
  expect(paceAnnouncementMessage(sample,prior)).toBe('8.3キロを通過。ここまでの走行で貯金は36秒です。');
 expect(paceAnnouncementMessage({...sample,meters:NaN})).toBe('');
});
