import { ActiveRun, RunRecord } from '../types/run';
import { validateRuns } from '../utils/run-backup';
import { canonical, SqliteStore, SqlSnapshot } from './sqlite-store';

export type Digest = (text: string) => Promise<string>;
export type SqliteBackup = { format: 'runjourney-sqlite-backup'; schemaVersion: 2; databaseSchema: 1; exportedAt: string; snapshot: SqlSnapshot; sha256: string };
export function validateSnapshot(snapshot: SqlSnapshot) {
  if (!snapshot || !Array.isArray(snapshot.runs) || !snapshot.settings || typeof snapshot.settings !== 'object' || Array.isArray(snapshot.settings)) throw new Error('SQLite backup構造が不正です');
  validateRuns(snapshot.runs);
  if (snapshot.protectedIds && (!Array.isArray(snapshot.protectedIds) || snapshot.protectedIds.some(id => typeof id !== 'string' || ![...snapshot.runs.map(run => run.id), snapshot.draft?.id].includes(id)))) throw new Error('保護対象IDが不正です');
  if (new Set(snapshot.runs.map(r => r.id)).size !== snapshot.runs.length) throw new Error('Backup内で走行IDが重複しています');
  if (snapshot.draft !== null) {
    const draft = snapshot.draft;
    if (!draft || typeof draft !== 'object') throw new Error('draft構造が不正です');
    // Validation-only end time; never persist an inferred value.
    validateRuns([{ ...draft, endedAt: draft.endedAt ?? draft.startedAt } as RunRecord]);
    if (snapshot.runs.some(run => run.id === draft.id && canonical(run) !== canonical(draft))) throw new Error('履歴とdraftのIDが衝突しています');
  }
  for (const [key, value] of Object.entries(snapshot.settings)) if (!key.startsWith('@runjourney/') || key.length > 256 || typeof value !== 'string') throw new Error('設定の形式が不正です');
}
export async function encodeBackup(store: SqliteStore, digest: Digest, exportedAt = new Date().toISOString()): Promise<string> {
  const snapshot = await store.snapshot(); validateSnapshot(snapshot);
  const body = { format: 'runjourney-sqlite-backup' as const, schemaVersion: 2 as const, databaseSchema: 1 as const, exportedAt, snapshot };
  return canonical({ ...body, sha256: await digest(canonical(body)) });
}
export async function decodeBackup(text: string, digest: Digest): Promise<SqliteBackup> {
  const backup = JSON.parse(text) as SqliteBackup;
  if (backup?.format !== 'runjourney-sqlite-backup' || backup.schemaVersion !== 2 || backup.databaseSchema !== 1 || typeof backup.sha256 !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) throw new Error('未対応または不正なSQLite backupです');
  const { sha256, ...body } = backup;
  if (await digest(canonical(body)) !== sha256) throw new Error('バックアップのSHA-256が一致しません');
  validateSnapshot(backup.snapshot); return backup;
}
export async function restoreBackup(store: SqliteStore, text: string, digest: Digest) {
  const backup = await decodeBackup(text, digest); return store.restore(backup.snapshot);
}
export type { ActiveRun };
