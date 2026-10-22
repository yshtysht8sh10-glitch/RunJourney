import { activeBoundaryWallTime, kilometerLaps, savingsMessage, savingsSeconds, spokenDuration, stopHint, voiceSnapshot } from '@/domain/voice-guidance';
import { verifyVoiceLog } from '@/domain/voice-log';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS, windowPace } from '@/domain/pace-workout';
import { ActiveRun, LocationPoint } from '@/types/run';
import { effectiveDistance, timeModel, transition } from '@/utils/run-model';
const point = (t: number, meters: number, speed = 3): LocationPoint => ({ timestamp: t, latitude: 35 + meters / 111195, longitude: 139, accuracy: 5, speed });
function run(pace = 350): ActiveRun {
  const points = Array.from({ length: 151 }, (_, i) => point(i * 5000, i * 5000 / pace));
  const r: ActiveRun = { id: 'savings', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points, distanceMeters: 0,
    features: { autoStop: true, break: true }, events: [], paceWorkout: createPaceWorkout({ ...DEFAULT_PACE_SETTINGS, enabled: true }, 0) };
  r.distanceMeters = effectiveDistance(r); return r;
}
test.each([[350, 25], [400, -25]])('lap %ss/km uses unrounded active distance boundary', (pace, saving) => {
  const r = run(pace), laps = kilometerLaps(r, 750000);
  expect(laps[0].lapMs / 1000).toBeCloseTo(pace, 1);
  expect(laps[0].lapSavings).toBeCloseTo(saving, 1);
  expect(laps[0].cumulativeSavings).toBeCloseTo(saving, 1);
  expect(laps[0].message).toContain(saving > 0 ? '増えました' : '減りました');
  expect(JSON.parse(JSON.stringify(laps))).toEqual(laps);
});
test('positive saving becomes delay with natural Japanese and second rounding', () => {
  expect(savingsSeconds(1000, 350000, 375)).toBe(25);
  expect(savingsSeconds(2000, 800000, 375)).toBe(-50);
  expect(savingsMessage(-30)).toBe('累計で30秒遅れています。');
  expect(spokenDuration(70)).toBe('1分10秒'); expect(spokenDuration(359.9)).toBe('6分');
});
test.each(['AUTO_STOP', 'BREAK'] as const)('%s freezes saving, even over a km boundary', state => {
  let r = run(); r = transition(r, state, 350000, 'user');
  const before = voiceSnapshot(r, 350000), after = voiceSnapshot(r, 650000);
  expect(after.cumulativeSavingsSec).toBe(before.cumulativeSavingsSec);
  expect(after.activeMs).toBe(before.activeMs); expect(after.stoppedMs).toBe(300000);
  r = transition(r, 'RUNNING', 650000, 'user');
  expect(timeModel(r, 680000).activeRunningTime).toBe(380000);
  const laps = kilometerLaps(r, 750000);
  expect(laps.every(l => l.lapMs > 0 && Number.isFinite(l.lapMs))).toBe(true);
});
test('audio hint is independent and cancels on moving, noise, missing speed, stale data', () => {
  const points = [point(1000, 0, 0), point(2000, 0.2, 0), point(3000, 0.4, 0)];
  const original = JSON.stringify(points);
  expect(stopHint(points, 3000)).toBe(true);
  expect(stopHint(points, 7000)).toBe(false);
  expect(stopHint(points.map(p => ({ ...p, speed: undefined })), 3000)).toBe(false);
  expect(stopHint(points.map(p => ({ ...p, accuracy: 30 })), 3000)).toBe(false);
  expect(stopHint(points.map((p, i) => point(p.timestamp, i * 2, 0.8)), 3000)).toBe(false);
  expect(stopHint([points[0], points[0], points[2]], 3000)).toBe(false);
  expect(JSON.stringify(points)).toBe(original);
});
test('reproduction: moving 30s with stationary tail suppresses a misleading slow warning', () => {
  const points = Array.from({ length: 7 }, (_, i) => point(i * 5000, Math.min(i, 5) * 15, 0));
  expect(windowPace(points, 30000, 0).pace).toBeNull();
  expect(windowPace(points.slice(0, -1), 90000, 0).pace).toBeNull();
  expect(windowPace(points, 30000, 25000).pace).toBeNull();
});
test('captured log operands recompute saving, stopped time and all-run prediction', () => {
  const data = voiceSnapshot(run(), 750000);
  const text = JSON.stringify([{ id: 'one', data }]);
  expect(verifyVoiceLog(text)[0]).toMatchObject({ savingsCorrect: true, stoppedTimeExcluded: true, marathonCorrect: true, lapSavingsCorrect: null });
  expect(verifyVoiceLog(JSON.stringify([{ data: { ...data, cumulativeSavingsSec: 9999 } }]))[0].savingsCorrect).toBe(false);
  expect(verifyVoiceLog('[{}]')[0].savingsCorrect).toBeNull();
});

test('wall deadline of a completed active boundary never advances during a stop or restored callback', () => {
  let r = transition(run(), 'AUTO_STOP', 350000, 'sensor', 355000);
  expect(activeBoundaryWallTime(r, 300000, 360000)).toBeCloseTo(300000, 2);
  expect(activeBoundaryWallTime(r, 300000, 960000)).toBeCloseTo(300000, 2);
  r = transition(r, 'RUNNING', 650000, 'sensor', 660000);
  expect(activeBoundaryWallTime(r, 400000, 750000)).toBeCloseTo(700000, 2);
});
