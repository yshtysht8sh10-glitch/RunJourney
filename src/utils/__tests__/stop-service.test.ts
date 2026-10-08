import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { RunService } from '@/services/run-service';
import { RunRepository } from '@/repositories/run-repository';
import { ActiveRun } from '@/types/run';
jest.mock('@/tasks/location-task', () => ({ LOCATION_TASK_NAME: 'test-location' }));
jest.mock('@/services/voice-announcement', () => ({ VoiceAnnouncement: { stop: jest.fn(), restore: jest.fn() } }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { Fitness: 3 }, hasStartedLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn(), startLocationUpdatesAsync: jest.fn(), getForegroundPermissionsAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const draft = (): ActiveRun => ({ id: 'service', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 0, points: [] });
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); await RunRepository.saveActiveRun(draft()); jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true); });
afterEach(() => jest.restoreAllMocks());

test('concurrent service STOP calls share one save and preserve STOP time while stopping GPS', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(10000);
  let done!: () => void;
  jest.mocked(Location.stopLocationUpdatesAsync).mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  const first = RunService.stopRun(), second = RunService.stopRun();
  expect(first).toBe(second);
  await Promise.resolve();
  done();
  const record = await first;
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(await RunRepository.getRuns()).toEqual([record]);
  expect(await RunRepository.getActiveRun()).toBeNull();
});

test('restoring failed-save snapshot does not restart GPS or request permissions', async () => {
  const frozen = { ...draft(), endedAt: new Date(10000).toISOString() };
  await RunRepository.saveActiveRun(frozen);
  expect(await RunService.restoreActiveRun()).toEqual(frozen);
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('GPS stop failure keeps draft and permits retry, no history before success', async () => {
  jest.mocked(Location.stopLocationUpdatesAsync).mockRejectedValueOnce(new Error('OS failure')).mockResolvedValueOnce();
  await expect(RunService.stopRun()).rejects.toThrow('OS failure');
  expect(await RunRepository.getRuns()).toEqual([]);
  expect(await RunRepository.getActiveRun()).toEqual(draft());
  await RunService.stopRun();
  expect(await RunRepository.getRuns()).toHaveLength(1);
});
