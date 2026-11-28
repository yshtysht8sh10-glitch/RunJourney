/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import * as Location from 'expo-location';
import { CyclingService } from '@/services/cycling-service';
import { ingestCyclingLocationBatch } from '@/tasks/cycling-location-task';
import { CyclingVoice } from '@/services/cycling-voice';
import { CyclingRecorder } from '@/repositories/cycling-recorder';
import { SqliteStore, type SqlConnection } from '@/repositories/sqlite-store';
import { CYCLING_PROFILE } from '@/domain/measurement-profile';
import { connection, resetNative } from '@/test/native-driver';

let mockRecorder: CyclingRecorder, mockCycleStore: SqliteStore;
let mockOwner: { purpose: string; sessionId: string; status: string; startedAt: number; generation: number } | null = null;
const mockOrder: string[] = [];
jest.mock('@/repositories/cycling-database', () => ({ cyclingDatabase: async () => mockCycleStore }));
jest.mock('@/repositories/cycling-repository', () => ({ CyclingRepository: {
  getActive: () => mockRecorder.getActive(), create: (...args: Parameters<CyclingRecorder['create']>) => mockRecorder.create(...args),
  ingest: (...args: Parameters<CyclingRecorder['ingest']>) => mockRecorder.ingest(...args),
  pause: (...args: Parameters<CyclingRecorder['pause']>) => mockRecorder.pause(...args),
  prepareFinish: (at: string) => mockRecorder.prepareFinish(at), finish: () => mockRecorder.finish(),
} }));
jest.mock('@/repositories/top-settings', () => ({ TopSettingsRepository: { get: async () => ({ assistantEnabled: true }) } }));
jest.mock('@/services/cycling-voice', () => ({ CyclingVoice: { update: jest.fn(async () => undefined), stop: jest.fn(async () => { mockOrder.push('VOICE_END'); }) } }));
jest.mock('@/services/measurement-sessions', () => ({ measurementOwnershipAvailable: () => true, MeasurementSessions: {
  forStart: async () => { if (mockOwner && mockOwner.purpose !== 'cycling') throw Error('other purpose'); return mockOwner; },
  ensure: async (purpose: string, sessionId: string, startedAt: number) => mockOwner ??= { purpose, sessionId, startedAt, generation: 1, status: 'STARTING' },
  activate: async () => { mockOwner!.status = 'ACTIVE'; }, reconcile: async () => mockOwner,
  requestInputStop: jest.fn(),
  withBufferedInput: async (purpose: string, _receivedAt: number, _bytes: number, operation: (owner: unknown) => Promise<unknown>) =>
    mockOwner?.purpose === purpose && mockOwner.status === 'ACTIVE' ? operation(mockOwner) : null,
  withInput: async (purpose: string, operation: (owner: unknown) => Promise<unknown>) => mockOwner?.purpose === purpose && mockOwner.status === 'ACTIVE' ? operation(mockOwner) : null,
  freeze: async () => { mockOwner!.status = 'STOPPING'; mockOrder.push('FREEZE'); },
  finish: async () => { mockOrder.push('OWNER_ACK'); mockOwner = null; },
} }));
jest.mock('expo-task-manager', () => ({ isAvailableAsync: async () => true, isTaskDefined: () => false, defineTask: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'same-id' }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { Fitness: 3 }, PermissionStatus: { GRANTED: 'granted' },
  hasServicesEnabledAsync: async () => true, isBackgroundLocationAvailableAsync: async () => true,
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }), requestBackgroundPermissionsAsync: async () => ({ status: 'granted' }),
  getForegroundPermissionsAsync: async () => ({ status: 'granted' }), getBackgroundPermissionsAsync: async () => ({ status: 'granted' }),
  hasStartedLocationUpdatesAsync: async () => true, startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => { mockOrder.push('GPS_STOP'); }) }));

let native: DatabaseSync, running: SqliteStore, runningBefore: string;
const base = Date.parse('2026-11-28T00:00:00Z');
const fix = (second: number) => ({ timestamp: base + second * 1000, coords: { latitude: 35 + second * 20 / 111195,
  longitude: 139, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: 20 } });
beforeEach(async () => {
  resetNative(); jest.clearAllMocks(); mockOwner = null; mockOrder.length = 0;
  native = new DatabaseSync(':memory:');
  const sql: SqlConnection = { execAsync: async text => { native.exec(text); },
    runAsync: async (text, ...params) => native.prepare(text).run(...params),
    getAllAsync: async <T,>(text: string, ...params: (string | number | null)[]) => native.prepare(text).all(...params) as T[] };
  mockCycleStore = new SqliteStore(sql, CYCLING_PROFILE.distance); mockRecorder = new CyclingRecorder(async () => mockCycleStore);
  running = new SqliteStore(connection);
  const canary = { id: 'same-id', startedAt: new Date(base - 100000).toISOString(), endedAt: new Date(base - 90000).toISOString(),
    points: [], events: [], distanceMeters: 0, createdAt: '', updatedAt: '' };
  await running.saveDraft(canary); await running.complete(canary); await running.setSetting('voice', 'running-original');
  runningBefore = JSON.stringify(await running.snapshot());
  jest.useFakeTimers(); jest.setSystemTime(new Date(base));
});
afterEach(async () => { expect(JSON.stringify(await running.snapshot())).toBe(runningBefore); native.close(); jest.useRealTimers(); });

test('normal Cycling START/task/STOP uses only the Cycling DB, with final raw fix and owner ACK after save', async () => {
  const run = await CyclingService.start();
  for (let second = 0; second <= 13; second++) await ingestCyclingLocationBatch([fix(second)], base + second * 1000);
  jest.setSystemTime(base + 14000); const saved = (await CyclingService.stop())!;
  expect(saved.id).toBe(run.id); expect(saved.points.length).toBe(4); expect(saved.distanceMeters).toBeCloseTo(260, 0);
  expect(await mockCycleStore.getRun(saved.id)).not.toBeNull(); expect(mockOwner).toBeNull();
  expect(mockOrder).toEqual(['FREEZE', 'GPS_STOP', 'VOICE_END', 'OWNER_ACK']);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith('runjourney-cycling-location', expect.objectContaining({ timeInterval: 1000, distanceInterval: 0 }));
});
test('voice failure cannot undo successful GPS/history save', async () => {
  jest.mocked(CyclingVoice.stop).mockRejectedValueOnce(Error('TTS unavailable'));
  await CyclingService.start(); await ingestCyclingLocationBatch([fix(0), fix(5)], base + 5000);
  jest.setSystemTime(base + 6000); const saved = (await CyclingService.stop())!;
  expect(await mockCycleStore.getRun(saved.id)).not.toBeNull(); expect(mockOwner).toBeNull();
});
test('GPS startup failure retains the draft and fixed identity for restore', async () => {
  jest.mocked(Location.startLocationUpdatesAsync).mockRejectedValueOnce(Error('GPS startup'));
  await expect(CyclingService.start()).rejects.toThrow('GPS startup');
  expect((await mockCycleStore.getDraft())?.id).toBe('same-id');
  expect((await CyclingService.restore())?.id).toBe('same-id');
  jest.setSystemTime(base + 1000); await CyclingService.stop();
});
test('failed OS stop retains frozen draft and ownership; retry preserves original end time', async () => {
  await CyclingService.start(); await ingestCyclingLocationBatch([fix(0), fix(5)], base + 5000);
  jest.setSystemTime(base + 6000); jest.mocked(Location.stopLocationUpdatesAsync).mockRejectedValueOnce(Error('OS stop'));
  await expect(CyclingService.stop()).rejects.toThrow('OS stop');
  expect(mockOwner!.status).toBe('STOPPING'); expect((await mockCycleStore.getDraft())?.endedAt).toBe(new Date(base + 6000).toISOString());
  jest.setSystemTime(base + 20000); const saved = await CyclingService.stop();
  expect(saved?.endedAt).toBe(new Date(base + 6000).toISOString()); expect(mockOwner).toBeNull();
});
test('another sport prevents Cycling start before a Cycling draft or GPS registration is created', async () => {
  mockOwner = { purpose: 'running', sessionId: 'running', status: 'ACTIVE', startedAt: base, generation: 1 };
  await expect(CyclingService.start()).rejects.toThrow('other purpose');
  expect(await mockCycleStore.getDraft()).toBeNull(); expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});
