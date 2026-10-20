import { advancePaceWorkout, classifyPace, createPaceWorkout, DEFAULT_PACE_SETTINGS, safePaceMetadata, safelyAdvancePaceWorkout,
  segmentReached, steadyWorkout, targetPaceSeconds, targetTimeSeconds, validPaceSettings, validWorkout, windowPace } from '@/domain/pace-workout';
import { ActiveRun } from '@/types/run';
import { transition } from '@/utils/run-model';
import * as paceAnalysis from '@/utils/pace-analysis';

const settings = { ...DEFAULT_PACE_SETTINGS, enabled: true, voice: true, voiceIntervalSec: 60 };
const segment = steadyWorkout(settings).segments[0];
function run(): ActiveRun {
  return { id: 'pace', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [],
    distanceMeters: 0, events: [], features: { autoStop: true, break: true }, paceWorkout: createPaceWorkout(settings, 0) };
}
function step(r: ActiveRun, t: number, pace = 375) {
  const points = [...r.points];
  let distance = r.distanceMeters;
  for (let at = (points.at(-1)?.timestamp ?? -5000) + 5000; at <= t; at += 5000) {
    if (at > 0) distance += 5000 / pace;
    points.push({ timestamp: at, latitude: 35 + distance / 111195, longitude: 139, accuracy: 5, speed: 99 });
  }
  return advancePaceWorkout({ ...r, points, distanceMeters: distance }, t);
}
test('distance/time/pace conversions retain the unrounded canonical pace', () => {
  expect(targetTimeSeconds(5, 375)).toBe(1875);
  expect(targetPaceSeconds(5, 1875)).toBe(375);
  expect(targetTimeSeconds(42.195, targetPaceSeconds(42.195, 14340))).toBeCloseTo(14340, 10);
});
test.each([0, -1, NaN, Infinity, 201])('rejects invalid distance %s', distanceKm => {
  expect(validPaceSettings({ ...settings, distanceKm })).toBe(false);
});
test.each([0, 119, 1801, NaN, Infinity])('rejects invalid pace %s', paceSecPerKm => {
  expect(validPaceSettings({ ...settings, paceSecPerKm })).toBe(false);
});
test('rejects extreme tolerance, frequency and total time', () => {
  expect(validPaceSettings({ ...settings, toleranceSecPerKm: 121 })).toBe(false);
  expect(validPaceSettings({ ...settings, voiceIntervalSec: 0 })).toBe(false);
  expect(validPaceSettings({ ...settings, distanceKm: 200, paceSecPerKm: 1800 })).toBe(false);
});
test.each([[359.99, 'FAST'], [360, 'ON_TARGET'], [375, 'ON_TARGET'], [390, 'ON_TARGET'], [390.01, 'SLOW'], [NaN, 'UNKNOWN'], [null, 'UNKNOWN']] as const)(
  'inclusive band: %s → %s', (pace, status) => expect(classifyPace(pace, segment)).toBe(status));
test('one segment and ordered mixed distance/duration segments share the model', () => {
  expect(steadyWorkout(settings).segments).toHaveLength(1);
  const workout = { id: 'staged', segments: [
    { ...segment, id: 'warm', kind: 'warmup' as const, targetPaceSecPerKm: 405, target: { type: 'distance' as const, meters: 1000 } },
    { ...segment, id: 'steady', target: { type: 'duration' as const, seconds: 900 } },
    { ...segment, id: 'cool', kind: 'cooldown' as const, targetPaceSecPerKm: 420 },
  ] };
  expect(validWorkout(workout)).toBe(true);
  expect(workout.segments.map(s => s.id)).toEqual(['warm', 'steady', 'cool']);
  expect(segmentReached(workout.segments[0], 999, 9999)).toBe(false);
  expect(segmentReached(workout.segments[0], 1000, 1)).toBe(true);
  expect(segmentReached(workout.segments[1], 99999, 899)).toBe(false);
  expect(segmentReached(workout.segments[1], 1, 900)).toBe(true);
  expect(validWorkout({ ...workout, segments: [segment, segment] })).toBe(false);
});
test('steady rolling window ignores instantaneous provider speed and computes target error', () => {
  const r = step(step(run(), 30000), 60000);
  expect(r.paceWorkout?.currentPace).toBeCloseTo(375, 1);
  expect(r.paceWorkout?.delta).toBeCloseTo(0, 1);
  expect(r.paceWorkout?.status).toBe('ON_TARGET');
  expect(r.paceWorkout?.notice).toBeUndefined();
});
test('poor accuracy, missing accuracy and insufficient observations suppress evaluation', () => {
  const r = step(run(), 30000);
  expect(windowPace(r.points.slice(0, 2), 30000, 0).pace).toBeNull();
  expect(windowPace(r.points.map(p => ({ ...p, accuracy: 60 })), 30000, 0).pace).toBeNull();
  expect(windowPace(r.points.map(p => ({ ...p, accuracy: undefined })), 30000, 0).pace).toBeNull();
});
test('jitter / stationary and location jumps never produce FAST or SLOW warnings', () => {
  const r = step(run(), 30000);
  for (const points of [r.points.map((p, i) => ({ ...p, latitude: 35 + (i % 2) * 0.00002 })),
    r.points.map((p, i) => ({ ...p, latitude: p.latitude + (i === 3 ? 0.1 : 0) }))]) {
    const result = advancePaceWorkout({ ...run(), points }, 30000);
    expect(result.paceWorkout?.status).toBe('UNKNOWN');
    expect(result.paceWorkout?.notice).toBeUndefined();
  }
});
test('stale/gapped observations are UNKNOWN and long callbacks do not inflate success time', () => {
  let r = step(step(run(), 30000), 60000);
  r = advancePaceWorkout(r, 180000);
  expect(r.paceWorkout?.status).toBe('UNKNOWN');
  expect(r.paceWorkout?.validMs).toBe(60000);
  expect(r.paceWorkout?.unknownMs).toBe(120000);
  expect(r.paceWorkout?.unknownIntervals[0].reason).toBe('GAP');
});
test.each(['BREAK', 'AUTO_STOP'] as const)('%s freezes progress / warnings; resume waits for full window', state => {
  let r = step(step(run(), 30000, 450), 60000, 450);
  r = advancePaceWorkout(transition(r, state, 65000, 'user'), 65000, true);
  expect(r.paceWorkout?.status).toBe('UNKNOWN');
  const before = r.paceWorkout!.accountedActiveMs;
  r = advancePaceWorkout(r, 125000);
  expect(r.paceWorkout?.accountedActiveMs).toBe(before);
  expect(r.paceWorkout?.notice).toBeUndefined();
  r = advancePaceWorkout(transition(r, 'RUNNING', 130000, 'user'), 130000, true);
  r = step(r, 150000, 450);
  expect(r.paceWorkout?.status).toBe('UNKNOWN');
  r = step(r, 160000, 450); r = step(r, 190000, 450);
  expect(r.paceWorkout?.status).toBe('SLOW');
});
test.each([[300, 'FAST'], [450, 'SLOW']] as const)('%s pace warns only after two consecutive windows', (pace, status) => {
  let r = step(run(), 30000, pace);
  expect(r.paceWorkout?.status).toBe('UNKNOWN');
  r = step(r, 60000, pace);
  expect(r.paceWorkout?.status).toBe(status);
  expect(r.paceWorkout?.notice?.message).toContain(status === 'FAST' ? '速い' : '遅れ');
  expect(step(r, 90000, pace).paceWorkout?.notice).toBeUndefined();
  expect(step(step(r, 90000, pace), 120000, pace).paceWorkout?.notice).toBeDefined();
});
test('short reversals require reconfirmation; returning ON_TARGET speaks once', () => {
  let r = step(step(run(), 30000, 300), 60000, 300);
  r = step(r, 90000, 450);
  expect(r.paceWorkout?.status).toBe('UNKNOWN');
  r = step(r, 120000, 375);
  expect(r.paceWorkout?.notice).toBeUndefined();
  r = step(r, 150000, 375);
  expect(r.paceWorkout?.notice?.message).toContain('戻りました');
  r = step(step(r, 180000, 375), 210000, 375);
  expect(r.paceWorkout?.notice).toBeUndefined();
});
test('goal reached is notified once without changing STOP/events or GPS points', () => {
  let r = run();
  r.paceWorkout!.workout.segments[0].target = { type: 'distance', meters: 100 };
  r = step(r, 30000, 300);
  expect(r.paceWorkout?.reached).toBe(true);
  expect(r.paceWorkout?.notice?.goal).toBe(true);
  expect(r.endedAt).toBeUndefined(); expect(r.events).toEqual([]);
  const points = r.points;
  const next = advancePaceWorkout(r, 60000);
  expect(next.paceWorkout?.notice?.goal).not.toBe(true);
  expect(next.points).toBe(points);
});
test('voice OFF is silent, workout OFF is an exact no-op', () => {
  let r = run(); r.paceWorkout!.voice = false;
  r = step(step(r, 30000, 450), 60000, 450);
  expect(r.paceWorkout?.status).toBe('SLOW'); expect(r.paceWorkout?.notice).toBeUndefined();
  expect(createPaceWorkout(DEFAULT_PACE_SETTINGS, 0)).toBeUndefined();
  delete r.paceWorkout; expect(advancePaceWorkout(r, 100000)).toBe(r);
});
test('corrupt optional state is ignored and cannot mutate the core record', () => {
  const r = run(); r.paceWorkout = { version: 99 } as never;
  expect(safelyAdvancePaceWorkout(r, 60000)).toBe(r);
  expect(safePaceMetadata(r.paceWorkout)).toBeUndefined();
  expect(safePaceMetadata({ ...run().paceWorkout, extra: 'x'.repeat(50000) })).toBeUndefined();
});
test('new runtime session defers evaluation even when persisted old GPS window exists', () => {
  const r = { ...step(step(run(), 30000, 450), 60000, 450), id: 'restarted-runtime' };
  const restored = safelyAdvancePaceWorkout(r, 90000);
  expect(restored.paceWorkout?.status).toBe('UNKNOWN'); expect(restored.paceWorkout?.notice).toBeUndefined();
});
test('a thrown add-on calculation preserves the identical GPS record and distance', () => {
  let r = { ...step(run(), 30000), id: 'fault-isolated' };
  r = safelyAdvancePaceWorkout(r, 60000);
  r = step(r, 90000);
  // Set up a due evaluation using valid, recently collected fixes.
  r.paceWorkout!.evaluatedAt = 60000;
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const analysis = jest.spyOn(paceAnalysis, 'analyzePoints').mockImplementationOnce(() => { throw new Error('synthetic pace failure'); });
  try {
    expect(safelyAdvancePaceWorkout(r, 90000)).toBe(r);
    expect(warning).toHaveBeenCalledWith('Pace workout skipped; GPS record retained', expect.any(Error));
  } finally { analysis.mockRestore(); warning.mockRestore(); }
});
test('unknown interval storage remains bounded during a 24 hour synthetic workout', () => {
  let r = run();
  for (let now = 30000; now <= 86400000; now += 30000) {
    r = step(r, now, 375);
    // Keep only window points as a streaming caller would. Never need the full day.
    r = { ...r, points: r.points.slice(-7) };
    if (now % 60000 === 0) r.points[2] = { ...r.points[2], accuracy: 99 };
  }
  expect(r.paceWorkout!.unknownIntervals.length).toBeLessThanOrEqual(128);
  expect(JSON.stringify(r.paceWorkout).length).toBeLessThan(48000);
});
