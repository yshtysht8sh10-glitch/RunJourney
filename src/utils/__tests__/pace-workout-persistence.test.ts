import { RunRepository } from '@/repositories/run-repository';
import { PaceSettingsRepository, PACE_SETTINGS_KEY } from '@/repositories/pace-settings';
import { RunService } from '@/services/run-service';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { pagedDistanceLaps } from '@/domain/paged-analysis';
import { sourceFromRun } from '@/domain/pages';
import { database } from '@/repositories/database';
import { SqliteStore } from '@/repositories/sqlite-store';
import { connection, resetNative, trace } from '@/test/native-driver';
import { ActiveRun, RunRecord } from '@/types/run';
import { effectiveDistance, effectiveRun } from '@/utils/run-model';
import { encodeBackup, decodeBackup } from '@/repositories/sqlite-backup';
import { createHash } from 'node:crypto';

jest.mock('@/tasks/location-task', () => ({ LOCATION_TASK_NAME: 'pace-test-task' }));
jest.mock('@/utils/build', () => ({ isStandaloneTest: () => true }));
jest.mock('expo-task-manager', () => ({ isAvailableAsync: async () => true }));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { Fitness: 3 }, PermissionStatus: { GRANTED: 'granted' },
  hasServicesEnabledAsync: async () => true, isBackgroundLocationAvailableAsync: async () => true,
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }), requestBackgroundPermissionsAsync: async () => ({ status: 'granted' }),
  getForegroundPermissionsAsync: async () => ({ status: 'granted' }), getBackgroundPermissionsAsync: async () => ({ status: 'granted' }),
  hasStartedLocationUpdatesAsync: async () => true, startLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn() }));
jest.mock('@/services/voice-announcement', () => ({ VoiceAnnouncement: { restore: jest.fn(), updateRun: jest.fn(), stop: jest.fn() } }));
const settings = { ...DEFAULT_PACE_SETTINGS, enabled: true };
const start = Date.parse('2026-10-20T00:00:00Z');
function draft(): ActiveRun {
  return { id: 'pace-draft', startedAt: new Date(start).toISOString(), createdAt: '', updatedAt: '',
    points: [], distanceMeters: 0, events: [], paceWorkout: createPaceWorkout(settings, start) };
}
function points(seconds = 1000) {
  return Array.from({ length: seconds / 5 + 1 }, (_, i) => ({ timestamp: start + i * 5000, latitude: 35 + i * (5000 / 375) / 111195,
    longitude: 139, accuracy: 5 }));
}
beforeEach(async () => { resetNative(); await RunRepository.clearActiveRun(); jest.useFakeTimers(); jest.setSystemTime(start); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
test('settings survive SQLite reopen; invalid/corrupt settings safely fall back to OFF', async () => {
  await PaceSettingsRepository.save(settings);
  const reopened = new SqliteStore(connection);
  expect(JSON.parse((await reopened.getSetting(PACE_SETTINGS_KEY))!)).toEqual(settings);
  expect(await PaceSettingsRepository.get()).toEqual(settings);
  await expect(PaceSettingsRepository.save({ ...settings, paceSecPerKm: Infinity })).rejects.toThrow();
  await reopened.setSetting(PACE_SETTINGS_KEY, '{broken');
  expect((await PaceSettingsRepository.get()).enabled).toBe(false);
});
test('START snapshots workout settings; later settings edits do not change the active goal', async () => {
  await PaceSettingsRepository.save(settings);
  const r = await RunService.startRun();
  expect(r.paceWorkout?.workout.segments[0].targetPaceSecPerKm).toBe(375);
  await PaceSettingsRepository.save({ ...settings, paceSecPerKm: 420 });
  expect((await RunRepository.getActiveRun())?.paceWorkout).toEqual(r.paceWorkout);
  expect((await RunService.restoreActiveRun())?.paceWorkout).toEqual(r.paceWorkout);
});
test('ordinary START retains no workout metadata and previous history reads unchanged', async () => {
  expect((await RunService.startRun()).paceWorkout).toBeUndefined();
  const saved = (await RunService.stopRun())!;
  expect((await RunRepository.getRun(saved.id))?.paceWorkout).toBeUndefined();
});
test('GPS append, SQLite reopen, draft backup/restore and STOP retain targets and raw points', async () => {
  await RunRepository.saveActiveRun(draft());
  const raw = points(120);
  let live: ActiveRun | null = null;
  for (const p of raw) live = await RunRepository.appendActivePoints([p]);
  expect(live?.points).toEqual(raw);
  expect(live?.distanceMeters).toBeCloseTo(effectiveDistance({ ...draft(), points: raw }), 8);
  const reopened = new SqliteStore(connection);
  expect((await reopened.getDraft())?.paceWorkout).toEqual(live?.paceWorkout);
  const digest = async (s: string) => createHash('sha256').update(s).digest('hex');
  const decoded = await decodeBackup(await encodeBackup(reopened, digest), digest);
  resetNative(); await RunRepository.restoreSnapshot(decoded.snapshot);
  expect((await RunRepository.getActiveRun())?.paceWorkout).toEqual(live?.paceWorkout);
  jest.setSystemTime(start + 125000);
  const saved = (await RunService.stopRun())!;
  expect(saved.points).toEqual(raw);
  expect(saved.paceWorkout?.workout).toEqual(live?.paceWorkout?.workout);
  expect((await RunRepository.getRun(saved.id))?.points).toEqual(raw);
  expect((await RunRepository.getRun(saved.id))?.paceWorkout).toEqual(saved.paceWorkout);
});
test('malformed optional workout cannot lose GPS or prevent completion', async () => {
  const r = { ...draft(), points: points(30), paceWorkout: { version: 900 } as never };
  r.distanceMeters = effectiveDistance(r);
  await RunRepository.saveActiveRun(r);
  expect((await RunRepository.getActiveRun())?.paceWorkout).toBeUndefined();
  const saved = (await RunRepository.finishActiveRun(new Date(start + 30000).toISOString()))!;
  expect(saved.points).toEqual(r.points); expect(saved.paceWorkout).toBeUndefined();
});
test('1km laps interpolate boundaries across pages using the effective clock', async () => {
  const r: RunRecord = { ...draft(), points: points(1000), endedAt: new Date(start + 1000000).toISOString(),
    events: [{ timestamp: start + 100000, state: 'BREAK', source: 'user' }, { timestamp: start + 160000, state: 'RUNNING', source: 'user' }] };
  r.distanceMeters = effectiveDistance(r);
  const source = sourceFromRun(r), read = jest.spyOn(source, 'read');
  const laps = await pagedDistanceLaps(source);
  expect(laps).toHaveLength(3);
  expect(laps[0].distanceMeters).toBe(1000); expect(laps[1].distanceMeters).toBe(1000);
  expect(laps.reduce((sum, l) => sum + l.distanceMeters, 0)).toBeCloseTo(effectiveRun(r).distanceMeters, 8);
  expect(laps.reduce((sum, l) => sum + l.durationMs, 0)).toBeCloseTo(effectiveRun(r).activeRunningTime, 6);
  expect(read.mock.calls.filter(([kind]) => kind === 'gps').map(([, at]) => at)).toEqual([0, 128]);
});
test('long-history analysis uses only bounded paged GPS reads and preserves metadata for sync', async () => {
  const r = { ...draft(), points: points(11000), endedAt: new Date(start + 11000000).toISOString() };
  r.distanceMeters = effectiveDistance(r);
  await (await database()).complete(r);
  trace.length = 0;
  const laps = await pagedDistanceLaps(RunRepository.pagedSource(r.id));
  expect(laps.length).toBeGreaterThan(20);
  const gpsQueries = trace.filter(s => s.startsWith('SELECT') && s.includes('JOIN gps_points'));
  expect(gpsQueries.length).toBeGreaterThan(15);
  expect(gpsQueries.every(s => s.includes('LIMIT') || s.includes('position=?'))).toBe(true);
  const source = RunRepository.pagedSource(r.id);
  expect(JSON.stringify(await source.read('metadata', 0))).toContain('paceWorkout');
});
