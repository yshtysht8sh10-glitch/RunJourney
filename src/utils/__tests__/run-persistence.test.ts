import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { RunSettings } from '@/repositories/run-settings';
import { ActiveRun } from '@/types/run';
import { effectiveRun, stateOf, timeModel } from '@/utils/run-model';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await AsyncStorage.clear(); });
test('saved STOP total matches history laps when GPS spans START/STOP; raw fixes survive', async () => {
  const points = [0, 10000, 20000].map((timestamp, index) => ({ timestamp, latitude: 35 + index * 20 / 111195, longitude: 139, accuracy: 5 }));
  await RunRepository.saveActiveRun({ id: 'clipped', startedAt: new Date(5000).toISOString(), createdAt: '', updatedAt: '', points, distanceMeters: 40 });
  const record = (await RunRepository.finishActiveRun(new Date(15000).toISOString()))!;
  const effective = effectiveRun(record);
  expect(record.distanceMeters).toBeCloseTo(20, 0);
  expect(record.distanceMeters).toBe(effective.distanceMeters);
  expect(effective.laps().reduce((sum, lap) => sum + lap.distanceMeters, 0)).toBeCloseTo(record.distanceMeters, 7);
  expect((await RunRepository.getRuns())[0].points).toEqual(points);
});
test('missing settings default off and saved settings persist', async () => {
  expect(await RunSettings.get()).toEqual({ autoStop: false, break: false });
  await RunSettings.save({ autoStop: true, break: true });
  expect(await RunSettings.get()).toEqual({ autoStop: true, break: true });
});
test.each(['RUNNING', 'AUTO_STOP', 'BREAK'] as const)('repository restores %s and finish is idempotent, preserves history', async state => {
  const legacy = { id: 'old', startedAt: new Date(0).toISOString(), endedAt: new Date(10000).toISOString(), points: [], distanceMeters: 5, createdAt: '', updatedAt: '' };
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([legacy]));
  const run: ActiveRun = { ...legacy, id: 'new', endedAt: undefined, features: { autoStop: true, break: true }, events: state === 'RUNNING' ? [] : [{ state, timestamp: 1000, source: 'user' }] };
  await RunRepository.saveActiveRun(run);
  expect(stateOf((await RunRepository.getActiveRun())!)).toBe(state);
  await RunRepository.appendActivePoints([{ latitude: 35, longitude: 139, timestamp: 2000, accuracy: 5, speed: 2 }]);
  if (state === 'BREAK') expect(stateOf((await RunRepository.getActiveRun())!)).toBe('BREAK');
  const ended = await RunRepository.finishActiveRun(new Date(10000).toISOString());
  expect(timeModel(ended!).activeRunningTime).toBe(state === 'RUNNING' ? 10000 : 1000);
  expect(await RunRepository.finishActiveRun(new Date(10000).toISOString())).toBeNull();
  expect(await RunRepository.getRuns()).toContainEqual(legacy);
  expect(await RunRepository.getRuns()).toHaveLength(2);
});

test('repository confirms persisted candidate retroactively, removes jitter and keeps raw fixes', async () => {
  const run: ActiveRun = { id: 'pending', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0, features: { autoStop: true, break: true }, events: [] };
  const point = (timestamp: number, meters: number) => ({ timestamp, latitude: 35 + meters / 111195, longitude: 139, accuracy: 5, speed: 0 });
  await RunRepository.saveActiveRun(run);
  await RunRepository.appendActivePoints([point(10000, 0), point(14000, 4)]);
  const pending = (await RunRepository.getActiveRun())!;
  expect(pending.detector?.stillSince).toBe(10000);
  expect(pending.events).toEqual([]);
  expect(pending.distanceMeters).toBeGreaterThan(3);
  await RunRepository.appendActivePoints([point(15000, 7)]);
  const stopped = (await RunRepository.getActiveRun())!;
  expect(stopped.events?.at(-1)).toMatchObject({ timestamp: 10000, confirmedAt: 15000 });
  expect(stopped.distanceMeters).toBe(0);
  const record = (await RunRepository.finishActiveRun(new Date(20000).toISOString()))!;
  expect(record.points).toEqual([point(10000, 0), point(14000, 4), point(15000, 7)]);
  expect(timeModel(record).activeRunningTime).toBe(10000);
});
test('repository restores movement candidate and recovers confirmation-window distance', async () => {
  const point = (timestamp: number, meters: number, speed: number) => ({ timestamp, latitude: 35 + meters / 111195, longitude: 139, accuracy: 5, speed });
  const run: ActiveRun = { id: 'resume', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0, features: { autoStop: true, break: true }, events: [] };
  await RunRepository.saveActiveRun(run);
  await RunRepository.appendActivePoints([point(10000, 0, 0), point(15000, 0, 0), point(20000, 4, 1.5)]);
  expect((await RunRepository.getActiveRun())?.detector?.movement?.startedAt).toBe(20000);
  await RunRepository.appendActivePoints([point(25000, 12, 1.6)]);
  const resumed = (await RunRepository.getActiveRun())!;
  expect(stateOf(resumed)).toBe('RUNNING');
  expect(resumed.events?.at(-1)).toMatchObject({ timestamp: 20000, confirmedAt: 25000 });
  expect(resumed.distanceMeters).toBeCloseTo(8, 0);
  expect(timeModel(resumed, 25000).activeRunningTime).toBe(15000);
});
