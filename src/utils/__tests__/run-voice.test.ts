import AsyncStorage from '@react-native-async-storage/async-storage';
import native from '../../../modules/run-announcer';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { ActiveRun } from '@/types/run';
import { transition } from '@/utils/run-model';
import { Platform } from 'react-native';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: { start: jest.fn(), updateClock: jest.fn(), updateDistance: jest.fn(), transition: jest.fn(), updateAnnouncement: jest.fn(), stop: jest.fn(), test: jest.fn() } }));
const minute = 60000;
const base = (): ActiveRun => ({ id: 'v', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 1000, points: [], features: { autoStop: true, break: true }, events: [] });
beforeEach(async () => { jest.replaceProperty(Platform, 'OS', 'android'); await AsyncStorage.clear(); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(6 * minute); });
afterEach(() => jest.restoreAllMocks());
test.each(['AUTO_STOP', 'BREAK'] as const)('voice %s freezes before five minutes then resumes', async state => {
  await AsyncStorage.setItem('@runjourney/voice-announcement/v1', 'on');
  let run = transition(base(), state, 4 * minute, 'user');
  await VoiceAnnouncement.updateRun(run);
  expect(native.updateClock).toHaveBeenLastCalledWith(4 * minute, true);
  expect(native.updateAnnouncement).not.toHaveBeenCalled();
  expect(native.transition).toHaveBeenCalledWith(expect.any(String), state === 'BREAK' ? '休憩します' : '停止しました');
  run = transition(run, 'RUNNING', 6 * minute, 'user');
  jest.spyOn(Date, 'now').mockReturnValue(7 * minute);
  await VoiceAnnouncement.updateRun(run);
  expect(native.updateClock).toHaveBeenLastCalledWith(5 * minute, false);
  expect(native.updateAnnouncement).toHaveBeenCalledWith(1, expect.any(String));
});
test('voice disabled and features off do not announce transitions', async () => {
  await VoiceAnnouncement.updateRun(transition(base(), 'BREAK', minute, 'user'));
  expect(native.transition).not.toHaveBeenCalled();
  await AsyncStorage.setItem('@runjourney/voice-announcement/v1', 'on');
  await VoiceAnnouncement.updateRun({ ...base(), features: { autoStop: false, break: false } });
  expect(native.transition).not.toHaveBeenCalled();
});
