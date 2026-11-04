import { recoveryAnalysis } from '@/domain/recovery-analysis';
import type { RunRecord, RunHistoryItem } from '@/types/run';

const start = Date.parse('2026-11-03T06:00:00+09:00');
function run(): RunRecord {
  return { id: 'r', startedAt: new Date(start).toISOString(), endedAt: new Date(start + 3600000).toISOString(),
    createdAt: '', updatedAt: '', distanceMeters: 9000, points: Array.from({ length: 361 }, (_, i) => ({
      timestamp: start + i * 10000, latitude: 35 + (Math.min(i, 180) * 30 + Math.max(0, i - 180) * 20) / 111195,
      longitude: 139, accuracy: 5, speed: i < 180 ? 3 : 2 })) };
}
const history = (): RunHistoryItem[] => Array.from({ length: 4 }, (_, i) => ({ id: i ? 'r' + i : 'r',
  startedAt: new Date(start - i * 86400000).toISOString(), endedAt: '', distanceMeters: 9000, activeRunningTime: 3600000, kmPerHour: 9 }));

test('observes rolling windows and slowdown without changing history', () => {
  const r = run(), h = history(), original = JSON.stringify([r, h]);
  const result = recoveryAnalysis(h, r, true);
  expect(result.windows[0]).toMatchObject({ days: 4, distanceKm: 36, activeMinutes: 240, recordedRunDays: 4 });
  expect(result.consecutiveRecordedDays).toBe(4);
  expect(result.slowdownPercent).toBeCloseTo(50, 1);
  expect(result.inference).toContain('可能性');
  expect(JSON.stringify([r, h])).toBe(original);
});
test('insufficient history, stops, planned changes and poor GPS withhold inference', () => {
  const r = run(), h = history();
  expect(recoveryAnalysis(h, r, false).inference).toContain('控えます');
  expect(recoveryAnalysis(h.slice(0, 1), r, true).inference).toContain('控えます');
  r.points.forEach(p => { p.accuracy = 50; });
  expect(recoveryAnalysis(h, r, true).inference).toContain('控えます');
  const stopped = run(); stopped.events = [{ timestamp: start + 100000, state: 'AUTO_STOP', source: 'sensor' }, { timestamp: start + 130000, state: 'RUNNING', source: 'sensor' }];
  expect(recoveryAnalysis(h, stopped, true).inference).toContain('控えます');
});
