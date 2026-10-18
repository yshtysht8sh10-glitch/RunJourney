import { RunRepository } from '@/repositories/run-repository';
import { RunService } from '@/services/run-service';
import { resetNative, injectFault, connection } from '@/test/native-driver';
import * as Location from 'expo-location';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { database } from '@/repositories/database';
import { encodeBackup, decodeBackup } from '@/repositories/sqlite-backup';
/// <reference types="node" />
import { createHash } from 'node:crypto';
import { syntheticRun } from '@/test/long-run';
import { SCHEMA_VERSION } from '@/repositories/sqlite-store';
import { effectiveRun } from '@/utils/run-model';

jest.mock('@/tasks/location-task', () => ({ LOCATION_TASK_NAME: 'sqlite-test-task' }));
jest.mock('@/utils/build', () => ({ isStandaloneTest: () => true }));
jest.mock('expo-task-manager', () => ({ isAvailableAsync: async () => true }));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('expo-application', () => ({ applicationId: 'app.runjourney.mobile.test' }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { Fitness: 3 }, PermissionStatus: { GRANTED: 'granted' },
  hasServicesEnabledAsync: async () => true, isBackgroundLocationAvailableAsync: async () => true,
  requestForegroundPermissionsAsync: async () => ({status:'granted'}), requestBackgroundPermissionsAsync: async () => ({status:'granted'}),
  hasStartedLocationUpdatesAsync: async () => true, startLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn() }));
jest.mock('@/services/voice-announcement', () => ({ VoiceAnnouncement: {restore:jest.fn(),updateRun:jest.fn(),stop:jest.fn()} }));

beforeEach(async () => { resetNative(); await RunRepository.clearActiveRun(); jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-09T10:00:00Z')); });
afterEach(() => { injectFault(); jest.restoreAllMocks(); jest.useRealTimers(); });
test('normal START/GPS/BREAK/resume/STOP are persisted in SQLite; raw fixes and event values survive', async () => {
  await (await database()).setSetting('@runjourney/run-features/v1','{"autoStop":true,"break":true}');
  const started = await RunService.startRun();
  expect(started.id).not.toContain('isolated-file');
  const now = Date.parse(started.startedAt);
  const points = [0,1000,2000].map(t => ({timestamp:now+t,latitude:35+t/1000000,longitude:139,accuracy:5,speed:2,altitude:10}));
  await RunRepository.appendActivePoints(points);
  jest.setSystemTime(now+3000); await RunService.breakRun();
  jest.setSystemTime(now+4000); await RunService.resumeRun();
  jest.setSystemTime(now+5000);
  const saved = (await RunService.stopRun())!;
  expect(saved.points).toEqual(points);
  const reopened = await (await database()).getRun(started.id);
  expect(reopened?.points).toEqual(points); expect(reopened?.events).toEqual(saved.events);
  expect(reopened?.events?.map(e=>e.state)).toEqual(['BREAK','RUNNING']);
  expect(await RunRepository.getActiveRun()).toBeNull();
  expect((await RunRepository.getHistoryPage()).map(row=>row.id)).toEqual([started.id]);
});
test('START voice failure and SQLite GPS write failure preserve the last committed draft', async () => {
  jest.mocked(VoiceAnnouncement.restore).mockRejectedValueOnce(new Error('voice startup failed'));
  await expect(RunService.startRun()).rejects.toThrow('voice startup failed');
  const draft = (await RunRepository.getActiveRun())!; expect(draft).not.toBeNull();
  let failed=false;injectFault(sql=>{if(!failed&&sql.startsWith('INSERT INTO gps_points')){failed=true;throw new Error('write failed')}});
  await expect(RunRepository.appendActivePoints([{latitude:35,longitude:139,timestamp:Date.parse(draft.startedAt)}])).rejects.toThrow('write failed');
  expect((await (await database()).getDraft())?.points).toEqual([]);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalled();
});
test('v2 backup checksum and draft/settings round trip use the production SQLite store', async () => {
  await RunService.startRun();
  const db=await database();await db.setSetting('@runjourney/run-features/v1','{"autoStop":true,"break":true}');
  const digest=async(text:string)=>createHash('sha256').update(text).digest('hex');
  const backup=await encodeBackup(db,digest),decoded=await decodeBackup(backup,digest);
  resetNative(); await RunRepository.restoreSnapshot(decoded.snapshot);
  expect(await db.snapshot()).toEqual(decoded.snapshot);
  await expect(decodeBackup(backup.replace('true','false'),digest)).rejects.toThrow();
  expect((await connection.getAllAsync<{user_version:number}>('PRAGMA user_version'))[0].user_version).toBe(SCHEMA_VERSION);
});
test('rescued 23 + ended draft remain intact; explicit draft completion and new START use one SQLite', async () => {
  const originalRuns = Array.from({ length: 23 }, (_, i) => syntheticRun(.01, 5000, `synthetic-preserved-${i}`));
  const draft = syntheticRun(.01, 5000, 'synthetic-ended-draft');
  draft.distanceMeters = effectiveRun(draft).distanceMeters;
  await RunRepository.restoreSnapshot({runs:originalRuns,draft,settings:{},protectedIds:[...originalRuns.map((run:{id:string})=>run.id),draft.id]});
  expect(await RunRepository.getBackupRuns()).toEqual(originalRuns);
  expect(await RunService.restoreActiveRun()).toEqual(draft);
  await expect(RunService.startRun()).rejects.toThrow('保存を再試行');
  const saved = (await RunRepository.finishActiveRun(new Date(Date.now()).toISOString()))!;
  expect(saved.id).toBe(draft.id);expect(saved.endedAt).toBe(draft.endedAt);
  expect(saved.points).toEqual(draft.points);expect(saved.events).toEqual(draft.events);
  expect(saved.distanceMeters).toBe(draft.distanceMeters);
  const after = await RunRepository.getBackupRuns();expect(after).toHaveLength(24);
  for (const run of originalRuns) expect(after.find(r=>r.id===run.id)).toEqual(run);
  expect(await RunRepository.finishActiveRun(new Date().toISOString())).toBeNull();
  const next = await RunService.startRun();expect(after.some(run=>run.id===next.id)).toBe(false);
});
