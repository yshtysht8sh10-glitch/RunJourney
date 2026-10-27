import AsyncStorage from '@/test/sqlite-fixture';
import * as Location from 'expo-location';
import { RunService } from '@/services/run-service';
import { RunRepository } from '@/repositories/run-repository';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { ActiveRun } from '@/types/run';
import { FinishClock } from '@/services/finish-clock';
import { injectFault } from '@/test/native-driver';
jest.mock('@/tasks/location-task', () => ({ LOCATION_TASK_NAME: 'test-location' }));
jest.mock('@/services/finish-clock', () => ({ FinishClock: { start: jest.fn(), stop: jest.fn() } }));
jest.mock('@/services/voice-announcement', () => ({ VoiceAnnouncement: { stop: jest.fn(), restore: jest.fn(), finished: jest.fn() } }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { Fitness: 3 }, hasStartedLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn() }));
const draft = (): ActiveRun => ({ id: 'finish-integration', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 0, points: [], finishGoal: { kind: 'time', activeMs: 3600000 } });
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); await RunRepository.saveActiveRun(draft()); jest.spyOn(Date, 'now').mockReturnValue(3605000); jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true); });
afterEach(() => { injectFault(); jest.restoreAllMocks(); });
test('automatic and manual finish share one save; speech happens after committed history', async () => {
  jest.mocked(VoiceAnnouncement.finished).mockImplementation(async () => { expect(await RunRepository.getRuns()).toHaveLength(1); });
  const [a, b] = await Promise.all([RunService.checkGoal(), RunService.stopRun()]);
  expect(a?.id).toBe(b?.id);
  expect((await RunRepository.getRuns())).toHaveLength(1);
  expect((await RunRepository.getRuns())[0].achievement?.reachedAt).toBe(3600000);
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(FinishClock.stop).toHaveBeenCalled();
  expect(VoiceAnnouncement.finished).toHaveBeenCalledTimes(1);
});
test('late GPS during OS shutdown and after save cannot move the finish boundary', async () => {
  jest.mocked(Location.stopLocationUpdatesAsync).mockImplementationOnce(async () => {
    const frozen = (await RunRepository.getActiveRun())!;
    expect(frozen.endedAt).toBe(new Date(3600000).toISOString());
    await RunRepository.appendActivePoints([{ timestamp: 4000000, latitude: 36, longitude: 139 }]);
    expect((await RunRepository.getActiveRun())?.points).toEqual([]);
  });
  const saved = await RunService.checkGoal();
  expect(await RunRepository.appendActivePoints([{ timestamp: 5000000, latitude: 37, longitude: 139 }])).toBeNull();
  expect(await RunRepository.getRun(saved!.id)).toEqual(saved);
});
test('history write failure retains frozen target across restart-style retry', async () => {
  let failed = false;
  injectFault(sql => { if (!failed && /UPDATE runs SET position/.test(sql)) { failed = true; throw Error('history write failed'); } });
  await expect(RunService.checkGoal()).rejects.toThrow();
  const frozen = (await RunRepository.getActiveRun())!;
  expect(frozen.endedAt).toBe(new Date(3600000).toISOString());
  jest.mocked(Date.now).mockReturnValue(9000000);
  const saved = await RunService.stopRun();
  expect(saved?.endedAt).toBe(frozen.endedAt);
  expect(await RunRepository.getRuns()).toHaveLength(1);
});
test('speech failure never rejects successfully saved completion', async () => {
  jest.mocked(VoiceAnnouncement.finished).mockRejectedValueOnce(Error('TTS blocked'));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await expect(RunService.checkGoal()).resolves.toMatchObject({ achievement: { reachedAt: 3600000 } });
  expect(await RunRepository.getRuns()).toHaveLength(1);
});
test('manual STOP remains authoritative if a concurrent automatic check is retracted by a stop transition', async () => {
  const r = draft(); r.events = [{ state: 'AUTO_STOP', timestamp: 1000000, source: 'sensor' }];
  await RunRepository.saveActiveRun(r);
  const a = RunService.stopRun(true, r.id), b = RunService.stopRun();
  expect(a).toBe(b);
  const result = await a;
  expect(result?.id).toBe(r.id);
  expect(result?.achievement).toBeUndefined();
  expect(await RunRepository.getRuns()).toHaveLength(1);
});
