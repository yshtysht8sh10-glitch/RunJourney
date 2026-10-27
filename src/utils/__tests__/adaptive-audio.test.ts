import { AdaptiveAudio } from '@/services/adaptive-audio';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import Storage from '@/repositories/storage';
import native from '../../../modules/run-announcer';
import { resetNative } from '@/test/native-driver';
jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: { noiseControl: jest.fn(() => 'STARTING'), noiseDiagnostics: jest.fn() } }));
const originalAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
beforeEach(() => { resetNative(); jest.clearAllMocks(); jest.replaceProperty(Platform, 'OS', 'android'); Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true }); });
afterEach(() => { jest.restoreAllMocks(); Object.defineProperty(AppState, 'currentState', originalAppState); });
test('OFF by default; denied microphone never starts or enables capture', async () => {
  expect(await AdaptiveAudio.enabled()).toBe(false);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
  expect(await AdaptiveAudio.setEnabled(true)).toBe(false);
  expect(await AdaptiveAudio.enabled()).toBe(false); expect(native.noiseControl).not.toHaveBeenCalled();
});
test('explicit grant starts only during visible, audible runs; OFF stops capture', async () => {
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  expect(await AdaptiveAudio.setEnabled(true)).toBe(true);
  jest.mocked(native.noiseControl!).mockClear();
  await AdaptiveAudio.start('r'); expect(native.noiseControl).not.toHaveBeenCalled();
  await Storage.setItem('@runjourney/voice-announcement/v1', 'on');
  await AdaptiveAudio.start('r'); expect(native.noiseControl).toHaveBeenLastCalledWith('start', 'r');
  jest.mocked(native.noiseControl!).mockClear(); jest.replaceProperty(AppState, 'currentState', 'background');
  await AdaptiveAudio.start('r'); expect(native.noiseControl).not.toHaveBeenCalled();
  await AdaptiveAudio.setEnabled(false); expect(native.noiseControl).toHaveBeenLastCalledWith('stop', '');
});
test('native microphone restriction is isolated from normal recording', async () => {
  jest.mocked(native.noiseControl!).mockImplementation(() => { throw Error('microphone restricted'); });
  expect(() => AdaptiveAudio.finish()).not.toThrow(); expect(() => AdaptiveAudio.stop()).not.toThrow();
});
