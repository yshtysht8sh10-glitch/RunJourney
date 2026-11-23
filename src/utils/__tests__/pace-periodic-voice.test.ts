import native from '../../../modules/run-announcer';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { RunRepository } from '@/repositories/run-repository';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { ActiveRun } from '@/types/run';
import { Platform } from 'react-native';
import { resetNative } from '@/test/native-driver';

jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: {
  pacePeriodicVersion: jest.fn(() => 1), pacePeriodicState: jest.fn(),
  start: jest.fn(), updateClock: jest.fn(), updateDistance: jest.fn(),
  stop: jest.fn(), notifyBatch: jest.fn(), voiceLog: jest.fn(() => '[]'),
} }));
const periodicNative = native as typeof native & { pacePeriodicState: jest.Mock; pacePeriodicVersion: jest.Mock };
let next = 0;
const start = 1000000;
function run(): ActiveRun {
  const r: ActiveRun = { id: `fixed-${++next}`, startedAt: new Date(start).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 0,
    features: { autoStop: false, break: true }, events: [], points: [],
    paceWorkout: createPaceWorkout({ ...DEFAULT_PACE_SETTINGS, enabled: true, voice: true, voiceIntervalSec: 60 }, start) };
  r.points = Array.from({ length: 31 }, (_, i) => ({ timestamp: start + i * 5000, latitude: 35 + i * 15 / 111195, longitude: 139, accuracy: 5 }));
  r.paceWorkout!.notice = { key: 'old-status', at: start + 60000, goal: false, message: 'old state warning' };
  return r;
}
function batches() { return jest.mocked(native.notifyBatch!).mock.calls.map(([json]) => JSON.parse(json)); }
function paceNotices() { return batches().flatMap(b => b.notices).filter(n => n.type === 'PACE_WARNING'); }
beforeEach(() => {
  resetNative(); jest.replaceProperty(Platform, 'OS', 'android'); jest.clearAllMocks();
  periodicNative.pacePeriodicVersion.mockReturnValue(1);
  periodicNative.pacePeriodicState.mockReturnValue(JSON.stringify({ acceptedThrough: 0, activeFromMs: start }));
  jest.spyOn(Date, 'now').mockReturnValue(start + 120000);
  jest.spyOn(RunRepository, 'getRecentObservations').mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

test('capable Native receives fixed snapshots, schedule and no legacy duplicate/TTL', async () => {
  const r = run(); await VoiceAnnouncement.updateRun(r);
  expect(paceNotices()).toHaveLength(2);
  expect(paceNotices()[0]).toMatchObject({ scheduledAt: start + 60000, expiresAt: Number.MAX_SAFE_INTEGER,
    data: { pacePeriodicSnapshot: { slot: 1, startAt: start, endAt: start + 60000, quality: 'READY' } } });
  expect(paceNotices().some(n => n.message === 'old state warning')).toBe(false);
  expect(batches().at(-1).paceSchedule).toMatchObject({ runId: r.id, startedAt: start, intervalMs: 60000, enabled: true });
});

test('first-use handshake submits schedule but never reconstructs historical slots without an epoch', async () => {
  periodicNative.pacePeriodicState.mockReturnValue('null');
  await VoiceAnnouncement.updateRun(run());
  expect(paceNotices()).toHaveLength(0);
  expect(batches().at(-1).paceSchedule.enabled).toBe(true);
});

test('bridge failure leaves same immutable slot IDs eligible for retry; ACK suppresses them', async () => {
  const r = run(); const before = JSON.stringify(r);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.mocked(native.notifyBatch!).mockImplementationOnce(() => { throw Error('bridge failed'); });
  await VoiceAnnouncement.updateRun(r);
  const attempted = paceNotices().map(n => n.id);
  jest.mocked(native.notifyBatch!).mockClear();
  await VoiceAnnouncement.updateRun(r);
  expect(paceNotices().map(n => n.id)).toEqual(attempted);
  periodicNative.pacePeriodicState.mockReturnValue(JSON.stringify({ acceptedThrough: 2, activeFromMs: start }));
  jest.mocked(native.notifyBatch!).mockClear();
  await VoiceAnnouncement.updateRun(r);
  expect(paceNotices()).toHaveLength(0);
  expect(JSON.stringify(r)).toBe(before);
});

test('voice OFF is forwarded even when ordinary periodic and clock settings are disabled', async () => {
  const r = run(); r.paceWorkout!.voice = false;
  await VoiceAnnouncement.updateRun(r);
  expect(paceNotices()).toHaveLength(0);
  expect(batches().at(-1).paceSchedule.enabled).toBe(false);
});

test('state-only path sends the schedule first and does not perform numeric interval calculations', async () => {
  const r = run(); await VoiceAnnouncement.updateState(r);
  expect(paceNotices()).toHaveLength(0);
  expect(batches().at(-1).paceSchedule.enabled).toBe(true);
  await VoiceAnnouncement.updateRun(r);
  expect(paceNotices()).toHaveLength(2);
});

test('RUN end suppresses all old periodic callbacks without changing RUN data', async () => {
  const r = run(); VoiceAnnouncement.stop(r.id);
  await VoiceAnnouncement.updateRun(r);
  expect(paceNotices()).toHaveLength(0);
});

test('PACE-only restoration starts the shared heartbeat and disabling 5-minute speech does not stop it', async () => {
  const r = run();
  await VoiceAnnouncement.restore(r);
  expect(native.start).toHaveBeenCalledWith(start, 300000);
  expect(native.stop).not.toHaveBeenCalled();
  await VoiceAnnouncement.setEnabled(false, r);
  expect(native.stop).not.toHaveBeenCalled();
  // Drain the fire-and-forget start callback before this test's mocks reset.
  await VoiceAnnouncement.updateRun(r);
});
