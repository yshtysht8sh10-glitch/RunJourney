import { finishVoice } from '@/domain/finish-voice';
import { runMetrics } from '@/domain/review';
import { transition } from '@/utils/run-model';
import { RunRecord } from '@/types/run';

const run = (): RunRecord => ({ id: 'finish-audio', startedAt: new Date(0).toISOString(), endedAt: new Date(720000).toISOString(), createdAt: '', updatedAt: '',
  distanceMeters: 2000, features: { autoStop: true, break: true }, events: [],
  points: Array.from({ length: 145 }, (_, i) => ({ timestamp: i * 5000, latitude: 35 + i * (2000 / 144) / 111195, longitude: 139, speed: 2.8, accuracy: 5 })) });

test.each(['manual', 'distance', 'time'] as const)('%s results exactly reuse saved history metrics and bound lap speech', kind => {
  const r = run();
  if (kind !== 'manual') r.achievement = { goal: kind === 'time' ? { kind: 'time', activeMs: 720000 } : { kind: 'distance', meters: 2000 }, reachedAt: 720000, detectedAt: 720100, distanceMeters: 2000, activeMs: 720000 };
  const before = JSON.stringify(r), result = finishVoice(r), history = runMetrics(r);
  expect(result.data.distanceMeters).toBe(history.distanceMeters);
  expect(result.data.activeMs).toBe(history.activeRunningTime);
  expect(result.data.averageSpeedKmh).toBe(history.pace.kmPerHour);
  expect(result.data.averagePaceSecPerKm).toBe(history.pace.secondsPerKm);
  expect(result.message.length).toBeLessThan(200);
  expect(result.message).toContain(kind === 'manual' ? '走行を終了しました' : '目標に到達');
  expect(JSON.stringify(r)).toBe(before);
});
test.each(['AUTO_STOP', 'BREAK'] as const)('finish during %s excludes stop time and speaks the saved values', state => {
  const r = transition(run(), state, 600000, 'user');
  r.endedAt = new Date(720000).toISOString();
  const result = finishVoice(r as RunRecord);
  expect(result.data.activeMs).toBe(600000);
  expect(result.message).toContain('実走時間10分');
});
test.each([0, 1, 29])('short/zero %sm runs omit unstable speed, pace and fabricated laps', meters => {
  const r = { ...run(), distanceMeters: meters, points: [] };
  const result = finishVoice(r);
  expect(result.data.averagePaceSecPerKm).toBeNull();
  expect(result.message).not.toMatch(/平均|NaN|Infinity|最後の1キロ/);
});
