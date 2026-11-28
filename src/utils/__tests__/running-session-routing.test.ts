import { RunService } from '@/services/run-service';
import { RunRepository } from '@/repositories/run-repository';
import { ingestLocationBatch } from '@/tasks/location-task';
import { MeasurementSessions } from '@/services/measurement-sessions';
import { resetNative } from '@/test/native-driver';
import * as Location from 'expo-location';

const mockOrder: string[] = [];
let mockLease = false;
const mockOwner = { sessionId: 'synthetic-running', purpose: 'running', startedAt: Date.parse('2026-11-28T00:00:00Z'),
  generation: 1, status: 'ACTIVE', profileVersion: 1, databaseKey: 'runjourney.sqlite' };
jest.mock('@/services/measurement-sessions', () => ({ measurementOwnershipAvailable: () => true, MeasurementSessions: {
  forStart: jest.fn(async () => null), ensure: jest.fn(async () => mockOwner), activate: jest.fn(async () => mockOwner),
  reconcile: jest.fn(async () => mockOwner), finish: jest.fn(async () => { mockOrder.push('FINISH_ACK'); }),
  requestInputStop: jest.fn(), closeInputs: jest.fn(async () => undefined), reopenInputs: jest.fn(),
  withBufferedInput: jest.fn(async (_purpose, _receivedAt, _bytes, write) => { mockLease = true; mockOrder.push('LEASE');
    try { return await write(mockOwner); } finally { mockLease = false; mockOrder.push('RELEASE'); } }),
  freeze: jest.fn(async () => { if (mockLease) throw Error('STOP cannot wait for its own lease'); mockOrder.push('FREEZE'); }),
  withInput: jest.fn(async (_purpose, write) => { mockLease = true; mockOrder.push('LEASE'); try { return await write(mockOwner); }
    finally { mockLease = false; mockOrder.push('RELEASE'); } }),
} }));
jest.mock('@/repositories/top-settings', () => ({ TopSettingsRepository: { get: async () => ({ assistantEnabled: true }) } }));
jest.mock('@/utils/build', () => ({ isStandaloneTest: () => true }));
jest.mock('expo-application', () => ({ applicationId: 'app.runjourney.mobile.test' }));
jest.mock('expo-task-manager', () => ({ isAvailableAsync: async () => true, isTaskDefined: () => false, defineTask: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-running' }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { Fitness: 3 }, PermissionStatus: { GRANTED: 'granted' },
  hasServicesEnabledAsync: async () => true, isBackgroundLocationAvailableAsync: async () => true,
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }), requestBackgroundPermissionsAsync: async () => ({ status: 'granted' }),
  hasStartedLocationUpdatesAsync: async () => true, startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(async () => { mockOrder.push('GPS_STOP'); }) }));
jest.mock('@/services/voice-announcement', () => ({ VoiceAnnouncement: { goalChanged: jest.fn(), started: jest.fn(),
  beforeGoal: jest.fn(), restore: jest.fn(), updateRun: jest.fn(), updateState: jest.fn(), updateDistance: jest.fn(), stop: jest.fn(), finished: jest.fn() } }));
jest.mock('@/services/adaptive-audio', () => ({ AdaptiveAudio: { start: jest.fn(), finish: jest.fn() } }));
jest.mock('@/services/sensor-diagnostics', () => ({ SensorDiagnostics: { begin: jest.fn(), end: jest.fn(), gps: jest.fn() } }));

beforeEach(async () => {
  resetNative(); await RunRepository.clearActiveRun(); jest.clearAllMocks(); mockOrder.length = 0; mockLease = false;
  jest.useFakeTimers(); jest.setSystemTime(new Date(mockOwner.startedAt));
});
afterEach(() => { jest.useRealTimers(); });
const fix = (second: number) => ({ timestamp: mockOwner.startedAt + second * 1000,
  coords: { latitude: 35 + second / 10000, longitude: 139, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: 10 } });

test('guarded Running still saves through the existing store; ownership finishes after GPS stop and SQL ACK', async () => {
  const run = await RunService.startRun();
  expect(MeasurementSessions.ensure).toHaveBeenCalledWith('running', run.id, Date.parse(run.startedAt));
  expect(MeasurementSessions.activate).toHaveBeenCalled();
  await ingestLocationBatch([fix(0), fix(5)], mockOwner.startedAt + 5000);
  expect((await RunRepository.getActiveRun())?.points.length).toBe(2);
  jest.setSystemTime(mockOwner.startedAt + 10000);
  const saved = (await RunService.stopRun())!;
  expect(await RunRepository.getRun(saved.id)).not.toBeNull();
  expect(mockOrder.indexOf('RELEASE')).toBeLessThan(mockOrder.indexOf('FREEZE'));
  expect(mockOrder.indexOf('GPS_STOP')).toBeLessThan(mockOrder.indexOf('FINISH_ACK'));
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
});

test('automatic goal STOP occurs outside the input lease, without self-drain deadlock', async () => {
  const run = await RunService.startRun();
  await RunRepository.updateFinishGoal(run.id, { kind: 'time', activeMs: 60000 }, true);
  jest.setSystemTime(mockOwner.startedAt + 61000);
  await ingestLocationBatch([fix(0), fix(5), fix(60)], mockOwner.startedAt + 61000);
  expect(mockOrder.indexOf('RELEASE')).toBeLessThan(mockOrder.indexOf('FREEZE'));
  expect(await RunRepository.getActiveRun()).toBeNull();
  expect((await RunRepository.getRun(run.id))?.endedAt).toBe(new Date(mockOwner.startedAt + 60000).toISOString());
});
