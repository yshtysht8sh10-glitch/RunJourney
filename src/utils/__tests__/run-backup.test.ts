import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { BACKUP_FORMAT, exportFilename, parseBackup, previewImport, serializeBackup } from '@/utils/run-backup';
import { serializeAnalysis } from '@/utils/run-analysis-export';
import { effectiveRun } from '@/utils/run-model';
import { TRASH_RETENTION_MS } from '@/utils/run-trash';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const key = '@runjourney/runs/v1', activeKey = '@runjourney/active-run/v1', settingsKey = '@runjourney/run-features/v1';
const run: RunRecord = { id: 'stable', startedAt: new Date(0).toISOString(), endedAt: new Date(610000).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 5,
  points: Array.from({ length: 123 }, (_, i) => ({ latitude: 35 + i * .0001, longitude: 139, timestamp: i * 5000, accuracy: 5, altitude: -1, speed: 2 })),
  features: { autoStop: true, break: true }, events: [{ timestamp: 50000, state: 'AUTO_STOP', source: 'sensor', confirmedAt: 55000 }, { timestamp: 60000, state: 'RUNNING', source: 'sensor' }, { timestamp: 80000, state: 'BREAK', source: 'user' }, { timestamp: 90000, state: 'RUNNING', source: 'user' }],
  stopOverrides: { '0:50000:AUTO_STOP': { included: true, updatedAt: '' } }, detector: { version: 3, last: { latitude: 35, longitude: 139, timestamp: 610000 } },
  diagnostics: { processed: 1, counts: { HOLD: 1 }, entries: [{ timestamp: 5000, state: 'RUNNING', decision: 'HOLD', reason: 'ACCURACY_POOR' }] } };
const backup = (runs: unknown[] = [run]) => JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: 1, app: { applicationId: 'app.runjourney.mobile.test' }, runs });
beforeEach(async () => { jest.restoreAllMocks(); await AsyncStorage.clear(); });
test('canonical round trip keeps active/trash/raw metadata/events/overrides/diagnostics/extensions and legacy fields', () => {
  const trash = { ...run, id: 'trash', trashedAt: 10, extension: { schema: 2 } };
  const legacy = { ...run, id: 'legacy', events: undefined, features: undefined, detector: undefined, diagnostics: undefined, stopOverrides: undefined };
  const text = serializeBackup([trash, run, legacy], { version: '0.1', versionCode: '8', gitCommit: 'abc' }, 1);
  const result = parseBackup(text);
  expect(result.format).toBe(BACKUP_FORMAT); expect(result.schemaVersion).toBe(1);
  expect(result.runs.find(r => r.id === 'trash')).toEqual(trash);
  expect(result.runs.find(r => r.id === run.id)).toEqual(run);
  expect(result.runs.find(r => r.id === 'legacy')).toEqual(JSON.parse(JSON.stringify(legacy)));
  expect(serializeBackup([legacy, run, trash], { gitCommit: 'abc', versionCode: '8', version: '0.1' }, 1)).toBe(text);
});
test.each([
  ['{', 'JSON'], [JSON.stringify([]), 'root'], [JSON.stringify({ format: 'analysis' }), 'RunJourney'],
  [JSON.stringify({ format: BACKUP_FORMAT }), 'schemaVersion'],
  [JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 2 }), '未対応'],
  [JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: 1, app: {} }), 'runs'],
])('rejects root errors: %s', (text, error) => expect(() => parseBackup(text)).toThrow(error));
test.each([
  { id: '' }, { startedAt: 'bad' }, { endedAt: new Date(-1).toISOString() }, { distanceMeters: -1 }, { trashedAt: -1 }, { trashedAt: null }, { trashedAt: 1e30 },
  { points: [{}] }, { points: [{ latitude: 91, longitude: 139, timestamp: 0 }] }, { points: [{ latitude: 35, longitude: 181, timestamp: 0 }] },
  { events: [{ timestamp: -1, state: 'BREAK', source: 'user' }] }, { events: [{ timestamp: 0, state: 'PAUSE', source: 'user' }] },
  { stopOverrides: { x: { included: 1, updatedAt: '' } } }, { detector: { movement: {} } }, { diagnostics: { entries: [{}], counts: {}, processed: 1 } },
])('rejects malformed run %j', fields => expect(() => parseBackup(backup([{ ...run, ...fields }]))).toThrow('不正'));
test.each([NaN, Infinity, -Infinity])('serializer refuses nonfinite values instead of lossy null: %s', value => {
  expect(() => serializeBackup([{ ...run, distanceMeters: value }], {}, 1)).toThrow();
  expect(() => serializeBackup([{ ...run, points: [{ ...run.points[0], speed: value }] }], {}, 1)).toThrow();
});
test('rejects oversized/deep structures and dangerous extension keys', () => {
  expect(() => parseBackup(' '.repeat(50 * 1024 * 1024 + 1))).toThrow('大きすぎ');
  let extension: unknown = {}; for (let i = 0; i < 25; i++) extension = { child: extension };
  expect(() => parseBackup(backup([{ ...run, extension }]))).toThrow();
  expect(() => parseBackup(backup([JSON.parse(JSON.stringify(run).replace('"stable"', '"stable","__proto__":{}'))]))).toThrow();
});
test('preview is read-only, stable-ID duplicate detection includes internal duplicates and distinct IDs with same dates', async () => {
  await AsyncStorage.setItem(key, backup());
  const result = previewImport([run, run, { ...run, id: 'other', trashedAt: 1 }], []);
  expect(result.additions).toHaveLength(2); expect(result.duplicates).toBe(1); expect(result.trash).toBe(1);
  expect(result.oldest).toBe(0); expect(await AsyncStorage.getItem(key)).toBe(backup());
});
test.each([undefined, 1])('existing lifecycle wins even if incoming lifecycle differs: %s', async trashedAt => {
  const existing = { ...run, trashedAt };
  await AsyncStorage.setItem(key, JSON.stringify([existing]));
  const before = await AsyncStorage.getItem(key);
  expect(await RunRepository.importRuns([{ ...run, trashedAt: trashedAt === undefined ? 1 : undefined }])).toEqual({ added: 0, skipped: 1 });
  expect(await AsyncStorage.getItem(key)).toBe(before);
});
test('single additive commit, repeated import adds zero; expired trash preserves date until normal purge', async () => {
  await AsyncStorage.setItem(key, JSON.stringify([run]));
  await AsyncStorage.setItem(activeKey, JSON.stringify({ id: 'in-progress' }));
  await AsyncStorage.setItem(settingsKey, 'settings');
  const incoming = [{ ...run, id: 'new' }, { ...run, id: 'trash', trashedAt: Date.now() }, { ...run, id: 'expired', trashedAt: Date.now() - TRASH_RETENTION_MS }];
  const write = jest.spyOn(AsyncStorage, 'setItem'); write.mockClear();
  expect(await RunRepository.importRuns(incoming)).toEqual({ added: 3, skipped: 0 });
  expect(write).toHaveBeenCalledTimes(1); expect(write.mock.calls[0][0]).toBe(key);
  expect(await RunRepository.getBackupRuns()).toEqual([run, ...incoming]);
  expect(await RunRepository.importRuns(incoming)).toEqual({ added: 0, skipped: 3 });
  expect((await RunRepository.getRuns()).map(r => r.id)).toEqual(['stable', 'new']);
  expect((await RunRepository.getTrashedRuns()).map(r => r.id)).toEqual(['trash']);
  expect(await AsyncStorage.getItem(activeKey)).toBe(JSON.stringify({ id: 'in-progress' }));
  expect(await AsyncStorage.getItem(settingsKey)).toBe('settings');
});
test('read-only export snapshot never purges trash', async () => {
  const stored = JSON.stringify([{ ...run, trashedAt: 0 }]); await AsyncStorage.setItem(key, stored);
  expect(await RunRepository.getBackupRuns()).toHaveLength(1); expect(await AsyncStorage.getItem(key)).toBe(stored);
});
test('all validation precedes write; failure, corrupt existing storage and active ID collision leave all data intact', async () => {
  await AsyncStorage.setItem(key, JSON.stringify([run])); const before = await AsyncStorage.getItem(key);
  expect(() => RunRepository.importRuns([{ ...run, id: 'valid' }, { ...run, distanceMeters: -1 }])).toThrow();
  expect(await AsyncStorage.getItem(key)).toBe(before);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(RunRepository.importRuns([{ ...run, id: 'new' }])).rejects.toThrow('disk full');
  expect(await AsyncStorage.getItem(key)).toBe(before);
  await AsyncStorage.setItem(activeKey, JSON.stringify({ id: 'new' }));
  await expect(RunRepository.importRuns([{ ...run, id: 'new' }])).rejects.toThrow('進行中');
  expect(await AsyncStorage.getItem(key)).toBe(before);
  await AsyncStorage.setItem(key, 'corrupt');
  await expect(RunRepository.importRuns([run])).rejects.toThrow(); expect(await AsyncStorage.getItem(key)).toBe('corrupt');
});
test('concurrent queued imports recheck duplicates and cannot lose updates', async () => {
  const results = await Promise.all([RunRepository.importRuns([run]), RunRepository.importRuns([run, { ...run, id: 'other' }])]);
  expect(results).toEqual([{ added: 1, skipped: 0 }, { added: 1, skipped: 1 }]); expect(await RunRepository.getBackupRuns()).toHaveLength(2);
});
test('analysis uses effective pace/laps/stops/override, excludes every GPS coordinate and raw diagnostics', () => {
  const effective = effectiveRun(run), text = serializeAnalysis(run, 1);
  expect(text).toContain(`Distance: ${(effective.distanceMeters / 1000).toFixed(2)}`);
  expect(text).toContain(`Average pace: ${effective.pace.secondsPerKm!.toFixed(2)}`);
  for (const lap of effective.laps()) expect(text).toContain(lap.kmPerHour!.toFixed(2));
  expect(text).toContain('yes (override)'); expect(text).toContain('BREAK');
  expect(text).toContain('Persisted GPS point count: 123');
  expect(text).not.toMatch(/latitude|longitude|139|35\.0001|NaN|Infinity/);
  expect(() => serializeAnalysis({ ...run, trashedAt: 1 })).toThrow();
});
test('zero distance / short / legacy analysis prints N/A and safe filenames', () => {
  const text = serializeAnalysis({ ...run, points: [], events: undefined, stopOverrides: undefined, endedAt: new Date(5000).toISOString() }, 1);
  expect(text).toContain('Average pace: N/A'); expect(text).not.toMatch(/NaN|Infinity/);
  expect(exportFilename('backup', 0)).toBe('runjourney-backup-1970-01-01T00-00-00Z.json');
});
