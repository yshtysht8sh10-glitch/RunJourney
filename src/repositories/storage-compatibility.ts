import * as Application from 'expo-application';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import LegacyStorage from '../../modules/legacy-storage-reader';
import { DATABASE_NAME, SqliteStore } from './sqlite-store';
import { legacyFingerprint, LEGACY_MIGRATION_SOURCE, migrateLegacyPlan, readLegacyPlan } from './legacy-migration';

export type CompatibilityState = { status: 'READY' | 'MIGRATION_REQUIRED' | 'FAILED'; message?: string; keys?: number; fingerprint?: string };
export const needsCompatibilityCheck = () => Platform.OS === 'android' && Application.applicationId === 'app.runjourney.mobile';
let checking: Promise<CompatibilityState> | undefined;
let migrating: Promise<CompatibilityState> | undefined;
const failure = (error: unknown): CompatibilityState => ({ status: 'FAILED', message: String(error instanceof Error ? error.message : error) });
async function withStore<T>(operation: (store: SqliteStore) => Promise<T>) {
  // A compatibility retry must not close or retain references to the ordinary repository connection.
  const connection = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  try {
    const store = new SqliteStore(connection);
    await store.initialize(); return await operation(store);
  } finally { await connection.closeAsync(); }
}
async function inspect(): Promise<CompatibilityState> {
  if (!needsCompatibilityCheck()) return { status: 'READY' };
  if (!LegacyStorage.available) throw Error('旧データの読取機能がありません。空の履歴へ切り替えず停止しました');
  const source = await LegacyStorage.open();
  try {
    if (source.applicationId !== 'app.runjourney.mobile') throw Error('保存領域のアプリ識別子が一致しません');
    const fingerprint = legacyFingerprint(source.entries);
    const reportText = await withStore(store => store.legacyMigrationReport(LEGACY_MIGRATION_SOURCE));
    if (reportText !== null) {
      const report = JSON.parse(reportText);
      if (report.version !== 1 || report.fingerprint !== fingerprint || !/^[a-f0-9]{64}$/.test(report.digest) || report.rule !== 'empty-only-exact-copy-protected-no-purge') {
        throw Error('旧データと移行完了記録が一致しません。再移行せず停止しました');
      }
      return { status: 'READY' };
    }
    if (!source.entries.length) return { status: 'READY' };
    return { status: 'MIGRATION_REQUIRED', keys: source.entries.length, fingerprint };
  } finally { if (source.token) await LegacyStorage.close(source.token); }
}
export function prepareStorage(): Promise<CompatibilityState> {
  return checking ??= inspect().catch(failure);
}
export async function assertStorageCompatible() {
  const state = await prepareStorage();
  if (state.status !== 'READY') throw Error(state.message ?? '旧データの互換確認が必要です。起動画面で確認してください');
}
/** Called only after the explicit confirmation screen. No default settings or normal RUN may write first. */
export function migrateLegacyStorage(): Promise<CompatibilityState> {
  if (migrating) return migrating;
  migrating = (async () => {
    const state = await prepareStorage();
    if (state.status !== 'MIGRATION_REQUIRED' || !needsCompatibilityCheck()) throw Error('初回移行を実行できる状態ではありません');
    const source = await LegacyStorage.open();
    try {
      if (source.applicationId !== 'app.runjourney.mobile' || !source.token || legacyFingerprint(source.entries) !== state.fingerprint) throw Error('確認後に旧データが変わりました。変更せず停止しました');
      const plan = await readLegacyPlan(LegacyStorage, source.token, source.entries);
      await withStore(store => migrateLegacyPlan(store, plan));
    } finally { if (source.token) await LegacyStorage.close(source.token); }
    return { status: 'READY' } as CompatibilityState;
  })().catch(failure).then(state => { checking = Promise.resolve(state); return state; }).finally(() => { migrating = undefined; });
  return migrating;
}
export function retryStorageCheck() {
  if (migrating) return migrating;
  checking = undefined; return prepareStorage();
}
