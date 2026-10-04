import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { TRASH_RETENTION_MS as retention } from '@/utils/run-trash';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const key = '@runjourney/runs/v1';
const now = 1800000000000;
const original: RunRecord = { id: 'a', startedAt: new Date(0).toISOString(), endedAt: new Date(20000).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 12,
  points: [{ latitude: 35, longitude: 139, timestamp: 10 }], features: { autoStop: true, break: true },
  events: [{ timestamp: 100, state: 'AUTO_STOP', source: 'sensor' }, { timestamp: 200, state: 'BREAK', source: 'user' }],
  stopOverrides: { '0:100:AUTO_STOP': { included: true, updatedAt: '' } }, diagnostics: { entries: [], counts: { HOLD: 2 }, processed: 2 } };
beforeEach(async () => { jest.spyOn(Date, 'now').mockReturnValue(now); await AsyncStorage.clear(); });
afterEach(() => jest.restoreAllMocks());
const seed = (runs: RunRecord[]) => AsyncStorage.setItem(key, JSON.stringify(runs));
test('legacy/mixed history separates active and trash; normal API and storage reload preserve lifecycle', async () => {
  await seed([original, { ...original, id: 'b', trashedAt: now }]);
  expect(await RunRepository.getActiveRuns()).toEqual([original]);
  expect(await RunRepository.getRuns()).toEqual([original]);
  expect((await RunRepository.getTrashedRuns()).map(r => r.id)).toEqual(['b']);
  expect(JSON.parse((await AsyncStorage.getItem(key))!)[1].trashedAt).toBe(now);
});
test('move is idempotent; restart-equivalent restore keeps ID/raw GPS/events/overrides/diagnostics and all fields', async () => {
  await seed([original]);
  await RunRepository.moveToTrash('a');
  jest.spyOn(Date, 'now').mockReturnValue(now + 1);
  await RunRepository.moveToTrash('a');
  expect(await RunRepository.getRuns()).toEqual([]);
  expect(await RunRepository.getTrashedRuns()).toEqual([{ ...original, trashedAt: now }]);
  // Rehydrate persisted JSON, rather than relying on an in-memory record.
  await seed(JSON.parse((await AsyncStorage.getItem(key))!));
  await RunRepository.restoreFromTrash('a');
  expect(await RunRepository.getRuns()).toEqual([original]);
  expect(await RunRepository.getTrashedRuns()).toEqual([]);
});
test.each([6 * 86400000, retention - 1, retention, retention + 1, 10 * 86400000])('purge exact elapsed boundary %s', async age => {
  await seed([original, { ...original, id: 'b', trashedAt: now - age }]);
  expect(await RunRepository.purgeExpiredTrash(now)).toBe(age >= retention ? 1 : 0);
  expect(await RunRepository.purgeExpiredTrash(now)).toBe(0);
  expect(await RunRepository.getRuns()).toEqual([original]);
});
test('multiple expiry, empty state input, expired restore refusal, and automatic read purge', async () => {
  await seed(['b', 'c'].map(id => ({ ...original, id, trashedAt: now - retention })));
  expect(await RunRepository.getTrashedRuns()).toEqual([]);
  await expect(RunRepository.restoreFromTrash('b')).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe('[]');
});
test('manual deletion refuses active history, affects only selected trash, and is idempotent', async () => {
  await seed([original, { ...original, id: 'b', trashedAt: now }, { ...original, id: 'c', trashedAt: now }]);
  await expect(RunRepository.deletePermanently('a')).rejects.toThrow();
  await RunRepository.deletePermanently('b'); await RunRepository.deletePermanently('b');
  expect((await RunRepository.getTrashedRuns()).map(r => r.id)).toEqual(['c']);
  expect(await RunRepository.getRuns()).toEqual([original]);
});
test('current run remains isolated and serialized moves/restores cannot lose other updates', async () => {
  const { endedAt: _endedAt, ...draft } = original;
  await RunRepository.saveActiveRun(draft);
  await expect(RunRepository.moveToTrash('a')).rejects.toThrow();
  await seed([original, { ...original, id: 'b' }]);
  await Promise.all([RunRepository.moveToTrash('a'), RunRepository.moveToTrash('b'), RunRepository.purgeExpiredTrash(now)]);
  expect(await RunRepository.getTrashedRuns()).toHaveLength(2);
  await Promise.all([RunRepository.restoreFromTrash('a'), RunRepository.deletePermanently('b')]);
  expect(await RunRepository.getRuns()).toEqual([original]);
  expect(await RunRepository.getActiveRun()).toEqual(draft);
});
test.each(['invalid', '{}', '[null]'])('corrupt storage fails closed without rewriting: %s', async stored => {
  await AsyncStorage.setItem(key, stored);
  await expect(RunRepository.purgeExpiredTrash(now)).rejects.toThrow();
  await expect(RunRepository.moveToTrash('a')).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe(stored);
});
test('invalid trash timestamps never cause automatic destruction', async () => {
  await seed([{ ...original, trashedAt: -1 }]);
  expect(await RunRepository.purgeExpiredTrash(now)).toBe(0);
});
