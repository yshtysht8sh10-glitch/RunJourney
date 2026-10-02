import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { effectiveDistance, effectiveRun, stopIntervals } from '@/utils/run-model';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const p = (timestamp: number, meters: number) => ({ timestamp, latitude: 35 + meters / 111195, longitude: 139, accuracy: 5, speed: 2 });
const record = (kind: 'AUTO_STOP' | 'BREAK' = 'AUTO_STOP'): RunRecord => ({ id: 'edit', startedAt: new Date(0).toISOString(), endedAt: new Date(40000).toISOString(), createdAt: 'original', updatedAt: 'original', distanceMeters: 40,
  events: [{ state: kind, timestamp: 10000, source: 'sensor', confirmedAt: 15000 }, { state: 'RUNNING', timestamp: 25000, source: 'sensor', confirmedAt: 30000 }],
  points: Array.from({ length: 9 }, (_, index) => p(index * 5000, index * 10)) });
beforeEach(async () => { await AsyncStorage.clear(); });
test.each(['AUTO_STOP', 'BREAK'] as const)('%s include/exclude persists and re-evaluates time/distance/pace non-destructively', async kind => {
  const original = record(kind), interval = stopIntervals(original)[0], before = effectiveRun(original);
  expect(interval).toMatchObject({ startMs: 10000, endMs: 25000, durationMs: 15000, included: false, kind });
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([original]));
  await RunRepository.setStopInclusion(original.id, interval.id, true);
  const included = (await RunRepository.getRuns())[0], after = effectiveRun(included);
  expect(after.activeRunningTime - before.activeRunningTime).toBe(15000);
  expect(after.distanceMeters).toBeGreaterThan(before.distanceMeters);
  expect(after.pace.secondsPerKm).not.toBe(before.pace.secondsPerKm);
  expect(included.points).toEqual(original.points); expect(included.events).toEqual(original.events);
  expect(included.startedAt).toBe(original.startedAt); expect(included.endedAt).toBe(original.endedAt);
  expect(included.updatedAt).toBe('original'); expect(included.distanceMeters).toBe(original.distanceMeters);
  expect(stopIntervals(JSON.parse(JSON.stringify(included)))[0].included).toBe(true);
  const excluded = await RunRepository.setStopInclusion(original.id, interval.id, false);
  expect(effectiveRun(excluded).distanceMeters).toBeCloseTo(before.distanceMeters, 7);
  expect(effectiveRun(excluded).activeRunningTime).toBe(before.activeRunningTime);
  expect(effectiveRun(excluded).pace.secondsPerKm).toBe(before.pace.secondsPerKm);
});
test('included stationary interval does not resurrect a long jitter polyline', () => {
  const run = record(); run.endedAt = new Date(200000).toISOString();
  run.events = [{ state: 'AUTO_STOP', timestamp: 0, source: 'sensor' }];
  run.points = Array.from({ length: 40 }, (_, index) => p(index * 5000, [0, 4, 0, -4][index % 4]));
  const id = stopIntervals(run)[0].id;
  expect(effectiveRun({ ...run, stopOverrides: { [id]: { included: true, updatedAt: '' } } }).distanceMeters).toBe(0);
});
test('excluded BREAK never bridges 300m walked movement and no-override keeps prior distance', () => {
  const run = record('BREAK'); run.points = [p(0, 0), p(5000, 10), p(15000, 100), p(20000, 200), p(25000, 300), p(30000, 310), p(35000, 320)];
  expect(effectiveRun(run).distanceMeters).toBeCloseTo(effectiveDistance(run), 7);
  expect(effectiveRun(run).distanceMeters).toBeLessThan(40);
  expect(effectiveRun({ ...run, events: undefined }).distanceMeters).toBeCloseTo(effectiveDistance({ ...run, events: undefined }), 7);
});
test('partitioned laps add to exactly the shared total before/after correction, including boundaries', () => {
  for (const included of [false, true]) {
    const run = record(), id = stopIntervals(run)[0].id;
    const effective = effectiveRun({ ...run, stopOverrides: { [id]: { included, updatedAt: '' } } });
    const laps = [effective.lap(0, 7777), effective.lap(7777, 19000), effective.lap(19000, effective.activeRunningTime)];
    expect(laps.reduce((sum, lap) => sum + lap.distanceMeters, 0)).toBeCloseTo(effective.distanceMeters, 7);
    expect(laps.every(lap => lap.secondsPerKm === null || Number.isFinite(lap.secondsPerKm))).toBe(true);
  }
});
test('invalid interval IDs cannot edit or overwrite stored originals', async () => {
  const original = record(); await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([original]));
  await expect(RunRepository.setStopInclusion('edit', 'missing', true)).rejects.toThrow();
  expect((await RunRepository.getRuns())[0]).toEqual(original);
});
test('invalid GPS/time values never yield NaN or infinite distance/pace', () => {
  const run = record(); run.points = [p(0, 0), { ...p(5000, 10), accuracy: NaN }, { ...p(10000, 20), timestamp: Infinity }];
  const effective = effectiveRun(run);
  expect(effective.distanceMeters).toBe(0); expect(effective.pace.secondsPerKm).toBeNull();
  expect(effectiveRun({ ...run, startedAt: 'invalid' }).activeRunningTime).toBe(0);
});
