import { goalAchievement, validFinishGoal } from '@/domain/finish-goal';
import { effectiveDistance, effectiveRun, timeModel } from '@/utils/run-model';
import { ActiveRun } from '@/types/run';
import { kilometerLaps } from '@/domain/voice-guidance';
const run = (): ActiveRun => ({ id: 'goal', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0, finishGoal: { kind: 'time', activeMs: 3600000 } });
test('manual is the safe default; pace goal alone never ends a run', () => {
  expect(goalAchievement({ ...run(), finishGoal: undefined }, 99999999)).toBeNull();
  expect(goalAchievement({ ...run(), finishGoal: { kind: 'manual' } }, 99999999)).toBeNull();
});
test.each(['AUTO_STOP', 'BREAK'] as const)('60 minute target excludes %s and continues from remaining time', state => {
  const r = run();
  r.events = [{ timestamp: 1200000, state, source: 'user' }, { timestamp: 1800000, state: 'RUNNING', source: 'user' }];
  expect(goalAchievement(r, 3600000)).toBeNull();
  const result = goalAchievement(r, 4300000)!;
  expect(result.reachedAt).toBe(4200000);
  expect(result.activeMs).toBe(3600000);
});
test('GPS-free time target uses durable active clock even on delayed background delivery', () => {
  const r = run();
  expect(goalAchievement(r, 3599999)).toBeNull();
  expect(goalAchievement(r, 3900000)?.reachedAt).toBe(3600000);
  r.events = [{ state: 'AUTO_STOP', timestamp: 3500000, source: 'sensor' }];
  expect(goalAchievement(r, 9000000)).toBeNull();
});
test('5km boundary is interpolated on effective edges; raw GPS survives, final lap sums agree', () => {
  const r = run(); r.finishGoal = { kind: 'distance', meters: 5000 };
  r.points = Array.from({ length: 503 }, (_, i) => ({ latitude: 35 + i * 10 / 111195, longitude: 139, timestamp: i * 5000, accuracy: 5 }));
  const original = JSON.stringify(r.points);
  const a = goalAchievement(r, 2510000)!;
  const ended = { ...r, endedAt: new Date(a.reachedAt).toISOString() };
  expect(effectiveDistance(ended)).toBeCloseTo(5000, 2);
  expect(a.reachedAt).toBeCloseTo(2500000, -2);
  expect(JSON.stringify(r.points)).toBe(original);
  const effective = effectiveRun(ended);
  expect(effective.laps().reduce((s, lap) => s + lap.distanceMeters, 0)).toBeCloseTo(effective.distanceMeters, 6);
  expect(kilometerLaps(ended, a.reachedAt).at(-1)?.activeMs ?? 0).toBeLessThanOrEqual(timeModel(ended).activeRunningTime);
  expect(kilometerLaps(ended, a.reachedAt)).toHaveLength(5);
});
test('GPS jumps and poor accuracy cannot satisfy distance target', () => {
  const r = run(); r.finishGoal = { kind: 'distance', meters: 100 };
  r.points = [{ latitude: 35, longitude: 139, timestamp: 0, accuracy: 5 }, { latitude: 36, longitude: 139, timestamp: 1000, accuracy: 5 }];
  expect(goalAchievement(r, 1000)).toBeNull();
  r.points[1] = { latitude: 35.001, longitude: 139, timestamp: 60000, accuracy: 100 };
  expect(goalAchievement(r, 60000)).toBeNull();
});
test.each([null, {}, { kind: 'time', activeMs: NaN }, { kind: 'distance', meters: -1 }, { kind: 'time', activeMs: Infinity }])('invalid goal is rejected: %j', value => expect(validFinishGoal(value)).toBe(false));
