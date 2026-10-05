import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { RunService } from '@/services/run-service';
import { isStandaloneTest } from '@/utils/build';
import { ActiveRun } from '@/types/run';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/utils/build', () => ({ isStandaloneTest: jest.fn(() => true) }));
jest.mock('@/services/voice-announcement', () => ({ VoiceAnnouncement: { restore: jest.fn(), updateDistance: jest.fn(), updateRun: jest.fn() } }));
jest.mock('expo-task-manager', () => ({ isTaskDefined: () => false, defineTask: jest.fn() }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { Fitness: 3 }, PermissionStatus: { GRANTED: 'granted' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })), getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false), startLocationUpdatesAsync: jest.fn() }));
const run: ActiveRun = { id: 'task', startedAt: new Date(0).toISOString(), points: [], distanceMeters: 0, features: { autoStop: false, break: true }, events: [], createdAt: '', updatedAt: '' };
const callback = jest.mocked(TaskManager.defineTask).mock.calls[0][1];
beforeEach(async () => { await RunRepository.clearActiveRun(); await AsyncStorage.clear(); jest.clearAllMocks(); jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false); jest.mocked(isStandaloneTest).mockReturnValue(true); await RunRepository.saveActiveRun(run); });
afterEach(async () => { await RunRepository.clearActiveRun(); });
test.each([true, false])('Test=%s location options preserve High accuracy and foreground service, Production stays 5s', async testBuild => {
  jest.mocked(isStandaloneTest).mockReturnValue(testBuild);
  await RunService.restoreActiveRun();
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    accuracy: 4, timeInterval: testBuild ? 1000 : 5000, distanceInterval: testBuild ? 0 : 5,
    deferredUpdatesDistance: 0, deferredUpdatesInterval: 0, foregroundService: expect.objectContaining({ killServiceOnDestroy: false }) }));
});
test('Test refreshes an existing native registration without deleting active data', async () => {
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
  await RunService.restoreActiveRun();
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalled();
  expect((await RunRepository.getActiveRun())!.id).toBe(run.id);
});
test.each([true, false])('TaskManager Test=%s routes batches without changing Production persistence', async testBuild => {
  jest.mocked(isStandaloneTest).mockReturnValue(testBuild);
  await callback({ data: { locations: Array.from({ length: 6 }, (_, i) => ({ timestamp: i * 1000,
    coords: { latitude: 35, longitude: 139, accuracy: null, speed: null, altitude: null } })) }, error: null, executionInfo: {} } as never);
  const saved = (await RunRepository.getActiveRun())!;
  expect(saved.points).toHaveLength(testBuild ? 2 : 6);
  expect(saved.diagnostics?.counts.GPS_OBS_COUNT).toBe(testBuild ? 6 : undefined);
  if (testBuild) expect((await RunRepository.getRecentObservations(10000, 5000)).at(-1)).toMatchObject({ speed: null, accuracy: null });
});
