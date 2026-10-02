import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import '@/tasks/location-task';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-task-manager', () => ({ isTaskDefined: () => false, defineTask: jest.fn() }));
jest.mock('@/services/voice-announcement', () => ({ VoiceAnnouncement: { updateDistance: jest.fn(), updateRun: jest.fn() } }));
beforeEach(async () => { await AsyncStorage.clear(); jest.mocked(VoiceAnnouncement.updateRun).mockClear(); });
test.each([true, false])('background GPS uses persisted feature snapshot (autoStop=%s)', async autoStop => {
  await RunRepository.saveActiveRun({ id: 'background', startedAt: new Date(0).toISOString(), points: [], createdAt: '', updatedAt: '', distanceMeters: 0,
    features: { autoStop, break: true }, diagnostics: { entries: [], counts: {}, processed: 0 } });
  const callback = jest.mocked(TaskManager.defineTask).mock.calls[0][1];
  await callback({ data: { locations: [0, 5000].map(timestamp => ({ timestamp, coords: { latitude: 35, longitude: 139, accuracy: 5, speed: 0, altitude: null } })) }, error: null, executionInfo: {} } as never);
  const restored = (await RunRepository.getActiveRun())!;
  expect(restored.events?.at(-1)?.state).toBe(autoStop ? 'AUTO_STOP' : undefined);
  expect(restored.points).toHaveLength(2);
  expect(restored.diagnostics?.processed).toBe(2);
  expect(VoiceAnnouncement.updateRun).toHaveBeenCalledWith(restored);
});
