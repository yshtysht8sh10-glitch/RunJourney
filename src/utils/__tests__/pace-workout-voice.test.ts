import native from '../../../modules/run-announcer';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { ActiveRun } from '@/types/run';
import { Platform } from 'react-native';
import { resetNative } from '@/test/native-driver';
jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: { updateWorkout: jest.fn(), start: jest.fn(),
  updateClock: jest.fn(), updateDistance: jest.fn(), transition: jest.fn(), updateAnnouncement: jest.fn(), stop: jest.fn() } }));
function run(): ActiveRun {
  const r: ActiveRun = { id: 'voice-pace', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [],
    distanceMeters: 100, paceWorkout: createPaceWorkout({ ...DEFAULT_PACE_SETTINGS, enabled: true, voice: true }, 0) };
  r.paceWorkout!.notice = { key: 'voice-pace:60000', message: '目標より少しペースが速いです。', at: 60000, goal: false };
  return r;
}
beforeEach(() => { resetNative(); jest.replaceProperty(Platform, 'OS', 'android'); jest.clearAllMocks(); });
afterEach(() => jest.restoreAllMocks());
test('workout voice uses the shared native bridge independently of #6 switch', async () => {
  await VoiceAnnouncement.updateRun(run());
  expect(native.updateWorkout).toHaveBeenCalledWith('voice-pace:60000', expect.stringContaining('速い'), 80000, true);
  expect(native.start).not.toHaveBeenCalled(); expect(native.updateAnnouncement).not.toHaveBeenCalled();
});
test.each(['BREAK', 'AUTO_STOP'] as const)('%s disables pending guidance in the shared queue', async state => {
  await VoiceAnnouncement.updateRun({ ...run(), events: [{ state, timestamp: 61000, source: 'user' }] });
  expect(native.updateWorkout).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Number), false);
});
test('workout voice OFF and invalid workout cannot enqueue speech', async () => {
  const r = run(); r.paceWorkout!.voice = false;
  await VoiceAnnouncement.updateRun(r);
  expect(native.updateWorkout).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.any(Number), false);
  r.paceWorkout = { version: 99 } as never;
  await VoiceAnnouncement.updateRun(r);
  expect(native.updateWorkout).toHaveBeenLastCalledWith('', '', 20000, false);
});
test('native TTS exception is contained; the supplied GPS record remains untouched', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const r = run(), original = JSON.stringify(r);
  jest.mocked(native.updateWorkout!).mockImplementationOnce(() => { throw new Error('TTS unavailable'); });
  await expect(VoiceAnnouncement.updateRun(r)).resolves.toBeUndefined();
  expect(JSON.stringify(r)).toBe(original);
});
test('non-Android gracefully uses visual guidance without loading a TTS module', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  await expect(VoiceAnnouncement.updateRun(run())).resolves.toBeUndefined();
  expect(native.updateWorkout).not.toHaveBeenCalled();
});
