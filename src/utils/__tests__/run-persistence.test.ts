import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { RunSettings } from '@/repositories/run-settings';
import { ActiveRun } from '@/types/run';
import { stateOf, timeModel } from '@/utils/run-model';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await AsyncStorage.clear(); });
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
