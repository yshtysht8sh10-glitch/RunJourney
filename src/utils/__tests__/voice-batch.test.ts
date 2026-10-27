import native from '../../../modules/run-announcer';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { RunRepository } from '@/repositories/run-repository';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { ActiveRun } from '@/types/run';
import { Platform } from 'react-native';
import { resetNative } from '@/test/native-driver';
import { effectiveDistance } from '@/utils/run-model';
jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: { stop: jest.fn(), notifyBatch: jest.fn(), voiceLog: jest.fn(() => '[]') } }));
let runId = 0;
const start = 1000000;
function run(): ActiveRun {
  const r: ActiveRun = { id: `batch-${++runId}`, startedAt: new Date(start).toISOString(), createdAt: '', updatedAt: '', events: [],
    points: [], distanceMeters: 0, features: { autoStop: true, break: true }, paceWorkout: createPaceWorkout({ ...DEFAULT_PACE_SETTINGS, enabled: true, voice: true }, start) };
  return r;
}
function notices() { return JSON.parse(jest.mocked(native.notifyBatch!).mock.calls.at(-1)![0]).notices as { type: string; message: string; expiresAt: number; priority: number; data: Record<string, number> }[]; }
beforeEach(() => { resetNative(); jest.replaceProperty(Platform, 'OS', 'android'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(start + 60000); jest.spyOn(RunRepository, 'getRecentObservations').mockResolvedValue([]); });
afterEach(() => jest.restoreAllMocks());
test('hint is audio-only, once per candidate, cancelled, cooled down, then confirmed/resumed', async () => {
  const r = run(), original = JSON.stringify(r);
  const samples = [0, 1000, 2000].map(dt => ({ timestamp: start + 58000 + dt, receivedAt: start + 60000, latitude: 35, longitude: 139, speed: 0, accuracy: 5 }));
  jest.mocked(RunRepository.getRecentObservations).mockResolvedValue(samples);
  await VoiceAnnouncement.updateRun(r);
  expect(notices().map(n => n.type)).toEqual(['STOP_CANDIDATE_DETECTED', 'STOP_CANDIDATE_ANNOUNCED']);
  expect(notices()[1].message).toBe('停止を確認しています。');
  const calls = jest.mocked(native.notifyBatch!).mock.calls.length;
  await VoiceAnnouncement.updateRun(r); expect(native.notifyBatch).toHaveBeenCalledTimes(calls);
  jest.mocked(RunRepository.getRecentObservations).mockResolvedValue([]);
  await VoiceAnnouncement.updateRun(r); expect(notices()[0].type).toBe('STOP_CANDIDATE_CANCELLED');
  jest.mocked(RunRepository.getRecentObservations).mockResolvedValue(samples);
  await VoiceAnnouncement.updateRun(r); expect(notices().some(n => n.type === 'STOP_CANDIDATE_ANNOUNCED')).toBe(false);
  expect(JSON.stringify(r)).toBe(original);
  r.events = [{ state: 'AUTO_STOP', source: 'sensor', timestamp: start + 55000, confirmedAt: start + 60000 }];
  await VoiceAnnouncement.updateRun(r); expect(notices().find(n => n.type === 'AUTO_STOP_CONFIRMED')?.message).toBe('走行タイマーを一時停止しました。');
  r.events.push({ state: 'RUNNING', source: 'sensor', timestamp: start + 59000, confirmedAt: start + 60000 });
  await VoiceAnnouncement.updateRun(r); expect(notices().find(n => n.type === 'AUTO_RESUME_CONFIRMED')?.message).toContain('走行再開を検知しました。');
});
test('batch carries priorities for simultaneous 5min, pace and km lap, plus verifiable boundary data', async () => {
  const r = run(); jest.mocked(Date.now).mockReturnValue(start + 360000);
  r.points = Array.from({ length: 73 }, (_, i) => ({ latitude: 35 + i * 15 / 111195, longitude: 139, timestamp: start + i * 5000, speed: 3, accuracy: 5 }));
  r.distanceMeters = effectiveDistance(r); r.detector = { last: r.points.at(-1) };
  r.paceWorkout!.notice = { key: 'warning', message: '遅いです', at: start + 360000, goal: false };
  await VoiceAnnouncement.setEnabled(true, null);
  await VoiceAnnouncement.updateRun(r);
  const batch = notices(); expect(batch.find(n => n.type === 'KILOMETER_LAP')?.priority).toBe(70);
  expect(batch.find(n => n.type === 'FIVE_MINUTES')?.priority).toBe(40);
  expect(batch.find(n => n.type === 'PACE_WARNING')?.priority).toBe(20);
  const lap = batch.find(n => n.type === 'KILOMETER_LAP')!;
  expect(lap.data.lapMs).toBeCloseTo(333333, -1);
  expect(lap.data.cumulativeSavingsSec).toBeCloseTo(375 - lap.data.activeMs / 1000, 8);
});
test('restored old callbacks retain original deadlines and never become fresh', async () => {
  const r = run(); r.events = [{ state: 'AUTO_STOP', source: 'sensor', timestamp: start, confirmedAt: start + 5000 }];
  await VoiceAnnouncement.updateRun(r);
  expect(notices()[0].expiresAt).toBe(start + 20000);
  expect(notices()[0].expiresAt).toBeLessThan(Date.now());
});
test('native failure never changes GPS/history', async () => {
  const r = run(); const before = JSON.stringify(r);
  r.paceWorkout!.notice = { key: 'goal', message: '目標到達', goal: true, at: start + 60000 };
  const captured = JSON.stringify(r);
  jest.mocked(native.notifyBatch!).mockImplementationOnce(() => { throw Error('service unavailable'); });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await expect(VoiceAnnouncement.updateRun(r)).resolves.toBeUndefined();
  expect(JSON.stringify(r)).toBe(captured); expect(before).not.toBe(captured);
});

test('a later stop candidate can announce again after cancellation and cooldown', async () => {
  const r = run();
  const samples = (now: number) => [now - 2000, now - 1000, now].map(timestamp => ({ timestamp, receivedAt: now, latitude: 35, longitude: 139, speed: 0, accuracy: 5 }));
  jest.mocked(RunRepository.getRecentObservations).mockResolvedValue(samples(start + 60000));
  await VoiceAnnouncement.updateRun(r);
  expect(notices().filter(n => n.type === 'STOP_CANDIDATE_ANNOUNCED')).toHaveLength(1);
  jest.mocked(RunRepository.getRecentObservations).mockResolvedValue([]);
  await VoiceAnnouncement.updateRun(r);
  jest.mocked(Date.now).mockReturnValue(start + 91000);
  jest.mocked(RunRepository.getRecentObservations).mockResolvedValue(samples(start + 91000));
  await VoiceAnnouncement.updateRun(r);
  expect(notices().filter(n => n.type === 'STOP_CANDIDATE_ANNOUNCED')).toHaveLength(1);
});

test('slow preference read does not create a hint from observations that expired during the wait', async () => {
  const r = run();
  let release!: (value: boolean) => void;
  jest.spyOn(VoiceAnnouncement, 'enabled').mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  jest.mocked(RunRepository.getRecentObservations).mockResolvedValue([start + 58000, start + 59000, start + 60000].map(timestamp => ({ timestamp, receivedAt: timestamp, latitude: 35, longitude: 139, speed: 0, accuracy: 5 })));
  const update = VoiceAnnouncement.updateRun(r);
  jest.mocked(Date.now).mockReturnValue(start + 71000);
  release(true); await update;
  expect(notices().some(n => n.type === 'STOP_CANDIDATE_ANNOUNCED')).toBe(false);
});

test('state feedback is dispatched before slow voice-item reads; early feedback sends no periodic items', async () => {
  const r = run();
  await VoiceAnnouncement.setEnabled(true, null);
  r.events = [{ state: 'AUTO_STOP', source: 'sensor', timestamp: start + 55000, confirmedAt: start + 60000 }];
  await VoiceAnnouncement.updateState(r);
  expect(notices().map(n => n.type)).toEqual(['AUTO_STOP_CONFIRMED']);
  expect(notices()[0].data.confirmedAt).toBe(start + 60000);
  const payload = JSON.parse(jest.mocked(native.notifyBatch!).mock.calls.at(-1)![0]);
  expect(payload.recovery.data.state).toBe('AUTO_STOP');
  expect(payload.recovery.message).toContain('時点');
});

test('manual finish discards an in-flight payload that was waiting for settings', async () => {
  const r = run();
  r.events = [{ state: 'AUTO_STOP', source: 'sensor', timestamp: start + 55000, confirmedAt: start + 60000 }];
  let release!: (value: boolean) => void;
  jest.spyOn(VoiceAnnouncement, 'enabled').mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const pending = VoiceAnnouncement.updateRun(r);
  VoiceAnnouncement.stop(r.id);
  release(true); await pending;
  expect(native.notifyBatch).not.toHaveBeenCalled();
  await VoiceAnnouncement.updateRun(r);
  expect(native.notifyBatch).not.toHaveBeenCalled();
});

