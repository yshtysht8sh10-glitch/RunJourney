import { hashText } from '../domain/pages';
import type { ActiveRun, RunRecord } from '../types/run';
import { canonical, type SqlSnapshot, type SqliteStore } from './sqlite-store';
import { validateSnapshot } from './sqlite-backup';

export const LEGACY_RUNS_KEY = '@runjourney/runs/v1';
export const LEGACY_DRAFT_KEY = '@runjourney/active-run/v1';
export const LEGACY_MIGRATION_SOURCE = 'android-rkstorage-v1';
// Bounds JS expansion as well as the Native cursor. Oversize is an error, never empty history.
export const LEGACY_MAX_CHARS = 8 * 1024 * 1024;
export type LegacyEntry = { key: string; length: number; sha256: string };
export type LegacyReader = {
  read(token: string, key: string, offset: number): Promise<{ text: string; nextOffset: number; done: boolean }>;
};
export type LegacyPlan = { snapshot: SqlSnapshot; fingerprint: string; keys: number };

export function legacyFingerprint(entries: LegacyEntry[]) {
  if (entries.length > 512 || new Set(entries.map(e => e.key)).size !== entries.length || entries.some(e =>
    !e.key.startsWith('@runjourney/') || e.key.length > 256 || !Number.isSafeInteger(e.length) || e.length < 0 || !/^[a-f0-9]{64}$/.test(e.sha256))) {
    throw Error('旧ストレージのキー・長さ・ハッシュが不正です。元データを保持して停止します');
  }
  if (entries.reduce((sum, e) => sum + e.length, 0) > LEGACY_MAX_CHARS) throw Error('旧データが初回移行の容量上限を超えています。元データを保持して停止します');
  return hashText(canonical([...entries].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
}

export async function readLegacyPlan(reader: LegacyReader, token: string, entries: LegacyEntry[]): Promise<LegacyPlan> {
  const fingerprint = legacyFingerprint(entries);
  const values: Record<string, string> = Object.create(null);
  for (const entry of entries) {
    const parts: string[] = [];
    let offset = 0;
    do {
      const part = await reader.read(token, entry.key, offset);
      const count = Array.from(part.text).length;
      if (!Number.isSafeInteger(part.nextOffset) || part.nextOffset !== offset + count || part.nextOffset > entry.length ||
        (!part.done && count === 0) || part.done !== (part.nextOffset === entry.length)) throw Error('旧データのチャンク順序・長さが不正です');
      parts.push(part.text); offset = part.nextOffset;
      if (part.done) break;
    } while (offset <= entry.length);
    const text = parts.join('');
    if (hashText(text) !== entry.sha256) throw Error('旧データのSHA-256が一致しません');
    values[entry.key] = text;
  }
  const runs: RunRecord[] = values[LEGACY_RUNS_KEY] === undefined ? [] : JSON.parse(values[LEGACY_RUNS_KEY]);
  const draft: ActiveRun | null = values[LEGACY_DRAFT_KEY] === undefined ? null : JSON.parse(values[LEGACY_DRAFT_KEY]);
  if (values[LEGACY_DRAFT_KEY] !== undefined && draft === null) throw Error('旧draftは不正なnullです');
  const settings = Object.fromEntries(Object.entries(values).filter(([key]) => key !== LEGACY_RUNS_KEY && key !== LEGACY_DRAFT_KEY));
  const snapshot = { runs, draft, settings };
  validateSnapshot(snapshot);
  // Interrupted legacy completion can leave both copies. Do not infer which is authoritative.
  if (draft && runs.some(run => run.id === draft.id)) throw Error('旧履歴とdraftのIDが重複しています。上書き・自動完了せず停止します');
  return { snapshot, fingerprint, keys: entries.length };
}

export async function migrateLegacyPlan(store: SqliteStore, plan: LegacyPlan) {
  validateSnapshot(plan.snapshot);
  return store.migrateLegacyEmpty(plan.snapshot, LEGACY_MIGRATION_SOURCE, plan.fingerprint, plan.keys);
}
