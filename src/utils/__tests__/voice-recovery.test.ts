import { recoveryGuidance, savingsMessage, stopHint, voiceSnapshot } from '@/domain/voice-guidance';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { ActiveRun, LocationPoint } from '@/types/run';
import { transition } from '@/utils/run-model';

const point = (timestamp: number, meters = 0, speed = 0, accuracy = 5): LocationPoint =>
  ({ timestamp, latitude: 35 + meters / 111195, longitude: 139, speed, accuracy });
const run = (): ActiveRun => ({ id: 'recovery', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [], events: [],
  distanceMeters: 1000, features: { autoStop: true, break: true }, paceWorkout: createPaceWorkout({ ...DEFAULT_PACE_SETTINGS, enabled: true }, 0) });

test('reproduction #43: preceding moving fix no longer delays the unchanged 2s stationary evidence', () => {
  const fixes = [point(0, -6, 3), point(1000, -3, 3), point(2000, 0), point(3000, 0.2), point(4000, 0.4), point(5000, 0.6), point(6000, 0.8)];
  expect(stopHint(fixes.slice(0, 4), 3000)).toBe(false);
  expect(stopHint(fixes.slice(0, 5), 4000)).toBe(true);
  // The previous implementation required *every* fix in the trailing 4s to be slow.
  const old = (received: LocationPoint[]) => received.filter(p => p.timestamp >= received.at(-1)!.timestamp - 4000).every(p => p.speed! <= 0.35);
  expect(old(fixes.slice(0, 5))).toBe(false);
  expect(old(fixes)).toBe(true);
});

test.each([
  ['walking', [point(0, 0, 0.7), point(1000, 0.7, 0.7), point(2000, 1.4, 0.7)]],
  ['position drift despite zero speed', [point(0), point(1000, 2), point(2000, 4)]],
  ['poor accuracy', [point(0, 0, 0, 30), point(1000), point(2000)]],
  ['brief stop', [point(0, 0, 2), point(1000), point(2000)]],
  ['duplicate', [point(0), point(0), point(2000)]],
  ['gap', [point(0), point(3000), point(4000)]],
] as const)('no early hint for %s', (_, points) => expect(stopHint([...points], points.at(-1)!.timestamp)).toBe(false));

test.each([[10, '10秒'], [30, '30秒'], [80, '1分20秒']])('cumulative lead %s seconds is explicit', (value, spoken) => {
  expect(savingsMessage(Number(value))).toBe(`目標より${spoken}早いです。`);
});
test.each([0, 0.1, -0.1])('zero tolerance remains symmetric: %s', value => expect(savingsMessage(value)).toBe('累計の貯金と遅れはありません。'));
test('delay uses the same cumulative units as lead', () => expect(savingsMessage(-30)).toBe('目標より30秒遅れています。'));

test('recovery regenerates updated distance, active time and saving; identifies the sampling boundary', () => {
  const r = run(), first = recoveryGuidance(r, 300000);
  expect(first.message).toContain('実走行5分時点');
  r.distanceMeters = 1200;
  const fresh = recoveryGuidance(r, 330000);
  expect(fresh.data).toEqual(voiceSnapshot(r, 330000));
  expect(fresh.message).toContain(savingsMessage(fresh.data.cumulativeSavingsSec!));
  expect(fresh.message).toContain('実走行5分30秒時点');
  expect(fresh.message).not.toEqual(first.message);
});
test.each(['AUTO_STOP', 'BREAK'] as const)('recovery during %s freezes cumulative saving without mutating history', state => {
  const r = transition(run(), state, 300000, 'sensor', 305000), original = JSON.stringify(r);
  const stopped = recoveryGuidance(r, 315000);
  expect(stopped.data.cumulativeSavingsSec).toBe(recoveryGuidance(r, 350000).data.cumulativeSavingsSec);
  const resumed = transition(r, 'RUNNING', 360000, 'sensor', 365000);
  expect(recoveryGuidance(resumed, 360000).data.cumulativeSavingsSec).toBe(stopped.data.cumulativeSavingsSec);
  expect(JSON.stringify(r)).toBe(original);
});
