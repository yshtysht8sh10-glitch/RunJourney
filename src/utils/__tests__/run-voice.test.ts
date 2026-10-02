import AsyncStorage from '@react-native-async-storage/async-storage';
import native from '../../../modules/run-announcer';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { ActiveRun } from '@/types/run';
import { detectStop, effectiveDistance, transition } from '@/utils/run-model';
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
  expect(native.updateClock).toHaveBeenLastCalledWith(4 * minute, true, 4 * minute);
  expect(native.updateAnnouncement).not.toHaveBeenCalled();
  expect(native.transition).toHaveBeenCalledWith(expect.any(String), state === 'BREAK' ? '休憩します' : '停止しました');
  run = transition(run, 'RUNNING', 6 * minute, 'user');
  run.detector = { version: 2, last: { latitude: 35, longitude: 139, timestamp: 7 * minute } };
  jest.spyOn(Date, 'now').mockReturnValue(7 * minute);
  await VoiceAnnouncement.updateRun(run);
  expect(native.updateClock).toHaveBeenLastCalledWith(5 * minute, false, 5 * minute);
  expect(native.updateAnnouncement).toHaveBeenCalledWith(1, expect.any(String));
});
test('voice disabled and features off do not announce transitions', async () => {
  await VoiceAnnouncement.updateRun(transition(base(), 'BREAK', minute, 'user'));
  expect(native.transition).not.toHaveBeenCalled();
  await AsyncStorage.setItem('@runjourney/voice-announcement/v1', 'on');
  await VoiceAnnouncement.updateRun({ ...base(), features: { autoStop: false, break: false } });
  expect(native.transition).not.toHaveBeenCalled();
});


test('sensor-confirmed 4min / 2min stop / 1min publishes exactly five-minute voice', async () => {
  await AsyncStorage.setItem('@runjourney/voice-announcement/v1', 'on');
  let run = base();
  for (const [timestamp, meters, speed] of [[235000, 0, 2], [240000, 0, 0], [245000, 3, 0], [355000, 0, 0], [360000, 4, 1.5], [365000, 12, 1.6], [420000, 122, 2]]) {
    const point = { timestamp, latitude: 35 + meters / 111195, longitude: 139, speed, accuracy: 5 };
    const next = detectStop(run, point);
    next.points = [...run.points, point]; next.distanceMeters = effectiveDistance(next); run = next;
    jest.spyOn(Date, 'now').mockReturnValue(timestamp);
    await VoiceAnnouncement.updateRun(run);
    if (timestamp < 420000) expect(native.updateAnnouncement).not.toHaveBeenCalled();
  }
  expect(native.updateClock).toHaveBeenLastCalledWith(300000, false, 300000);
  expect(native.updateAnnouncement).toHaveBeenCalledTimes(1);
  expect(native.updateAnnouncement).toHaveBeenCalledWith(1, expect.stringContaining('5分'));
});
test('pending 4:59 stop does not publish a provisional five-minute voice; OFF remains continuous', async () => {
  await AsyncStorage.setItem('@runjourney/voice-announcement/v1', 'on');
  let run = detectStop(base(), { timestamp: 299000, latitude: 35, longitude: 139, speed: 0, accuracy: 5 });
  jest.spyOn(Date, 'now').mockReturnValue(303900);
  await VoiceAnnouncement.updateRun(run);
  expect(native.updateClock).toHaveBeenLastCalledWith(303900, false, 299000);
  expect(native.updateAnnouncement).not.toHaveBeenCalled();
  run = detectStop(run, { timestamp: 304000, latitude: 35, longitude: 139, speed: 0, accuracy: 5 });
  jest.spyOn(Date, 'now').mockReturnValue(304000);
  await VoiceAnnouncement.updateRun(run);
  expect(native.updateClock).toHaveBeenLastCalledWith(299000, true, 299000);
  expect(native.updateAnnouncement).not.toHaveBeenCalled();
  await VoiceAnnouncement.updateRun({ ...base(), features: { autoStop: false, break: true } });
  expect(native.updateClock).toHaveBeenLastCalledWith(304000, false, -1);
  expect(native.updateAnnouncement).toHaveBeenCalledWith(1, expect.any(String));
});
