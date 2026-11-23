import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { RunDetailSummary } from '@/components/run-detail-summary';
import { sourceFromRun } from '@/domain/pages';
import { effectiveRun } from '@/utils/run-model';
import type { RunRecord } from '@/types/run';
let tree: ReactTestRenderer;
afterEach(() => { if (tree) act(() => tree.unmount()); });
test('shared small/large summary uses effective metrics and explicit labelled hierarchy without mutation', async () => {
  const run: RunRecord = { id:'summary', startedAt:new Date(0).toISOString(), endedAt:new Date(600000).toISOString(),createdAt:'',updatedAt:'',distanceMeters:1000,
    points:Array.from({length:121},(_,i)=>({timestamp:i*5000,latitude:35+i*.00008,longitude:139,accuracy:5})),features:{autoStop:true,break:true},
    events:[{timestamp:300000,state:'AUTO_STOP',source:'sensor'},{timestamp:360000,state:'RUNNING',source:'sensor'}] };
  const before=JSON.stringify(run), effective=effectiveRun(run), summary=await sourceFromRun(run).summary();
  expect(summary.distanceMeters).toBe(effective.distanceMeters); expect(summary.activeRunningTime).toBe(effective.activeRunningTime);
  act(()=>{tree=create(createElement(RunDetailSummary,{summary}));});
  const text=tree.root.findAllByType(Text).map(n=>[n.props.children].flat().join('')).join('|');
  expect(text.indexOf('総走行距離')).toBeLessThan(text.indexOf('平均ペース'));
  expect(text).toContain('平均時速');expect(text).toContain('開始日時');expect(text).toContain('終了日時');
  expect(text).toContain('実走時間 9分0秒');expect(text).toContain('全経過時間 10分0秒');
  const speed=effective.distanceMeters/effective.activeRunningTime*3600;
  expect(text).toContain(`平均時速 ${speed.toFixed(1)} km/h`); expect(JSON.stringify(run)).toBe(before);
});
test.each([[0,0],[0,1000],[1000,0],[Infinity,1000]])('missing metrics never display invalid numbers (%s/%s)',(distance,time)=>{
  act(()=>{tree=create(createElement(RunDetailSummary,{summary:{startedAt:'bad',endedAt:'bad',distanceMeters:distance,activeRunningTime:time,wallClockElapsed:0,pointCount:0}}));});
  const text=tree.root.findAllByType(Text).map(n=>[n.props.children].flat().join('')).join('|');
  expect(text).toContain('平均ペース —');expect(text).not.toMatch(/NaN|Infinity/);
});
