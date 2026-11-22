/* eslint-disable @typescript-eslint/no-require-imports -- Reload the coordinator's process cache to exercise restart recovery. */
import { resetNative } from '../../test/native-driver';
import { SqliteStore } from '../../repositories/sqlite-store';
import { hashText } from '../../domain/pages';
import { syntheticRun } from '../../test/long-run';

jest.mock('expo-application', () => ({ __esModule: true, applicationId: 'app.runjourney.mobile' }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../../../modules/legacy-storage-reader', () => ({ __esModule: true, default: { available: true, open: jest.fn(), read: jest.fn(), close: jest.fn() } }));
// Reset just the coordinator cache without reloading/resetting the native SQLite fixture.
let coordinator: typeof import('../../repositories/storage-compatibility');
let native: typeof import('../../../modules/legacy-storage-reader').default;
let app: typeof import('expo-application');
let values: Record<string, string>;
beforeEach(() => {
  resetNative(); jest.resetModules();
  coordinator = require('../../repositories/storage-compatibility');
  native = require('../../../modules/legacy-storage-reader').default;
  app = require('expo-application');
  values = { '@runjourney/run-features/v1': '{"autoStop":true,"break":false}' };
  jest.mocked(native.open).mockImplementation(async () => ({ applicationId: 'app.runjourney.mobile', token: 's', entries: Object.entries(values).map(([key, text]) => ({ key, length: Array.from(text).length, sha256: hashText(text) })) }));
  jest.mocked(native.read).mockImplementation(async (_token, key, offset) => ({ text: Array.from(values[key]).slice(offset).join(''), nextOffset: Array.from(values[key]).length, done: true }));
  jest.mocked(native.close).mockResolvedValue(undefined);
});
test('old settings alone block normal access until explicit migration; initialization writes no defaults', async () => {
  expect((await coordinator.prepareStorage()).status).toBe('MIGRATION_REQUIRED');
  await expect(coordinator.assertStorageCompatible()).rejects.toThrow('互換確認');
  // Coordinator opens the mock connection from the post-reset module registry.
  const db = new (require('../../repositories/sqlite-store').SqliteStore)(require('../../test/native-driver').connection) as SqliteStore;
  expect((await db.snapshot()).settings).toEqual({});
  expect((await coordinator.migrateLegacyStorage()).status).toBe('READY');
  await expect(coordinator.assertStorageCompatible()).resolves.toBeUndefined();
  expect((await db.snapshot()).settings).toEqual(values);
  expect(native.close).toHaveBeenCalledTimes(2);
});
test('missing reader and Native corruption are FAILED, never an empty history', async () => {
  native.available = false;
  expect((await coordinator.prepareStorage()).status).toBe('FAILED');
  native.available = true; jest.mocked(native.open).mockRejectedValueOnce(Error('LEGACY_DATABASE_CORRUPT'));
  expect(await coordinator.retryStorageCheck()).toEqual({ status: 'FAILED', message: 'LEGACY_DATABASE_CORRUPT' });
  await expect(coordinator.assertStorageCompatible()).rejects.toThrow('LEGACY_DATABASE_CORRUPT');
});
test('Test and Pace bypass Production legacy migration without opening old files', async () => {
  Object.defineProperty(app, 'applicationId', { value: 'app.runjourney.mobile.test', configurable: true });
  expect(await coordinator.prepareStorage()).toEqual({ status: 'READY' }); expect(native.open).not.toHaveBeenCalled();
});
test('source changed after confirmation blocks migration and always closes the read session', async () => {
  await coordinator.prepareStorage(); values['@runjourney/run-features/v1'] = 'changed';
  expect((await coordinator.migrateLegacyStorage()).status).toBe('FAILED');
  expect(native.close).toHaveBeenCalledTimes(2);
});
test('occupied target and same-ID data are not overwritten; no success marker', async () => {
  await coordinator.prepareStorage();
  const db = new (require('../../repositories/sqlite-store').SqliteStore)(require('../../test/native-driver').connection) as SqliteStore;
  await db.complete(syntheticRun(.01, 5000, 'occupied'));
  const before = await db.snapshot();
  expect((await coordinator.migrateLegacyStorage()).status).toBe('FAILED');
  expect(await db.snapshot()).toEqual(before);
});
test('reinspection accepts committed receipt without a duplicate copy, but detects changed legacy source', async () => {
  await coordinator.prepareStorage(); await coordinator.migrateLegacyStorage();
  expect((await coordinator.retryStorageCheck()).status).toBe('READY');
  values['@runjourney/new-setting'] = 'unexpected';
  expect((await coordinator.retryStorageCheck()).status).toBe('FAILED');
});
