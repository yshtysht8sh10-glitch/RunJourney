import native from '../../../modules/run-announcer';
import { GpsSimulator } from '@/test/gps-simulator';
import { GpsBatchReplay, type ReplayBatch } from '@/test/gps-batch-replay';
import { ingestLocationBatch } from '@/tasks/location-task';
import { RunRepository } from '@/repositories/run-repository';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { resetNative } from '@/test/native-driver';
import { database } from '@/repositories/database';
import type { ActiveRun } from '@/types/run';

jest.mock('@/utils/build', () => ({ isStandaloneTest: () => true }));
jest.mock('@/services/diagnostic-log', () => ({ diagnosticLog: jest.fn() }));
jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: {
  pacePeriodicVersion: () => 1, pacePeriodicState: jest.fn(), notifyBatch: jest.fn(), updateDistance: jest.fn(), stop: jest.fn(),
} }));
const start = 1800000000000;
let clock = start;
let cursor: { acceptedThrough: number; activeFromMs: number } | undefined;
let snapshots: { slot: number; startAt: number; endAt: number; quality: string }[];
beforeEach(() => {
  resetNative(); cursor = undefined; snapshots = []; clock = start; jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  jest.mocked(native.pacePeriodicState!).mockImplementation(() => JSON.stringify(cursor ?? null));
  jest.mocked(native.notifyBatch!).mockImplementation(text => {
    const batch = JSON.parse(text);
    if (batch.paceSchedule?.enabled && !cursor) cursor = { acceptedThrough: 0, activeFromMs: start };
    for (const notice of batch.notices) {
      const snapshot = notice.data?.pacePeriodicSnapshot;
      if (!snapshot) continue;
      expect(notice.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
      expect(snapshot.slot).toBe(cursor!.acceptedThrough + 1);
      snapshots.push(snapshot); cursor!.acceptedThrough = snapshot.slot;
    }
  });
});
afterEach(() => jest.restoreAllMocks());

test('receive-order replay enters the real adapter/SQL and current fixed-period PACE contract', async () => {
  const sim = new GpsSimulator(49, start), batches: ReplayBatch[] = [];
  for (let sec = 0; sec <= 6 * 60; sec++) {
    const locations = sim.step();
    if (locations.length) batches.push({ receivedAt: sim.now, appState: sec % 90 < 30 ? 'active' : 'background', locations });
  }
  const inputBefore = JSON.stringify(batches), replay = new GpsBatchReplay(batches, start);
  const run: ActiveRun = { id: 'PC-REPLAY-ONLY', startedAt: new Date(start).toISOString(), createdAt: '', updatedAt: '', points: [],
    distanceMeters: 0, events: [], features: { autoStop: true, break: true },
    paceWorkout: createPaceWorkout({ ...DEFAULT_PACE_SETTINGS, enabled: true, voice: true, voiceIntervalSec: 60 }, start) };
  await RunRepository.saveActiveRun(run); await VoiceAnnouncement.started(run);
  let batch: ReplayBatch | undefined;
  while ((batch = replay.step())) { clock = replay.now; await ingestLocationBatch(batch.locations, clock, batch.appState); }
  await RunRepository.flushCheckpoint();
  const saved = await RunRepository.finishActiveRun(new Date(clock).toISOString());
  expect(saved?.points.length).toBeGreaterThan(60);
  await expect((await database()).list(true).then(rows => rows.map(row => row.id))).resolves.toEqual([run.id]);
  expect(snapshots.length).toBeGreaterThanOrEqual(5);
  expect(new Set(snapshots.map(s => s.slot)).size).toBe(snapshots.length);
  for (const s of snapshots) { expect(s.startAt).toBe(start + (s.slot - 1) * 60000); expect(s.endAt).toBe(start + s.slot * 60000); }
  expect(snapshots.some(s => s.quality === 'READY')).toBe(true);
  expect(JSON.stringify(batches)).toBe(inputBefore);
}, 30000);

test('replay preserves duplicate/reversed fix order, pause clock and input ownership', () => {
  const sim = new GpsSimulator(3, start), fixes = [sim.step()[0], sim.step()[0]];
  const batch: ReplayBatch = { receivedAt: start + 5000, appState: 'background', locations: [fixes[1], fixes[0], fixes[0]] };
  const replay = new GpsBatchReplay([batch], start);
  replay.paused = true; expect(replay.step()).toBeUndefined(); expect(replay.now).toBe(start);
  replay.paused = false; const result = replay.step()!;
  expect(result.locations.map(p => p.timestamp)).toEqual(batch.locations.map(p => p.timestamp));
  result.locations[0].coords.latitude = 0; expect(batch.locations[0].coords.latitude).not.toBe(0);
  expect(replay.step()).toBeUndefined();
  expect(() => new GpsBatchReplay([{ ...batch, receivedAt: start - 1 }], start)).toThrow('REPLAY_INPUT_LIMIT_OR_CLOCK');
});
