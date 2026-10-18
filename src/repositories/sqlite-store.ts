import type { ActiveRun, RunRecord } from '../types/run';
import { effectiveRun } from '../utils/run-model';
import { PAGE_SCHEMA, migratePageIndex, stampRow } from './paged-store';
import { hashText, PAGE_ROWS, StreamKind } from '../domain/pages';

export interface SqlConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
}
export const DATABASE_NAME = 'runjourney.sqlite';
export const SCHEMA_VERSION = 2;
export type SqlSnapshot = { runs: RunRecord[]; draft: ActiveRun | null; settings: Record<string, string>; protectedIds?: string[] };
export const V17_SCHEMA = `
CREATE TABLE runs(id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','completed')),
 started_at TEXT NOT NULL, ended_at TEXT, distance REAL NOT NULL, trashed_at INTEGER,
 effective_distance REAL NOT NULL, effective_time REAL NOT NULL, position INTEGER NOT NULL DEFAULT 0, protected INTEGER NOT NULL DEFAULT 0);
CREATE INDEX run_history ON runs(status,trashed_at,started_at DESC);
CREATE TABLE active_run(slot INTEGER PRIMARY KEY CHECK(slot=1),run_id TEXT UNIQUE NOT NULL REFERENCES runs(id));
CREATE TABLE gps_points(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,seq INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=32768),PRIMARY KEY(run_id,seq));
CREATE TABLE gps_order(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,position INTEGER NOT NULL,
 seq INTEGER NOT NULL, PRIMARY KEY(run_id,position),FOREIGN KEY(run_id,seq) REFERENCES gps_points(run_id,seq));
CREATE TABLE run_events(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,seq INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=32768),PRIMARY KEY(run_id,seq));
CREATE TABLE run_metadata(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,chunk INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=32768),PRIMARY KEY(run_id,chunk));
CREATE TABLE run_operations(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,chunk INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=32768),PRIMARY KEY(run_id,chunk));
CREATE TABLE run_diagnostics(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,chunk INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=32768),PRIMARY KEY(run_id,chunk));
CREATE TABLE settings(key TEXT NOT NULL,chunk INTEGER NOT NULL,payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=32768),PRIMARY KEY(key,chunk));
CREATE TABLE migration_log(source TEXT PRIMARY KEY,report TEXT NOT NULL);
CREATE TRIGGER raw_gps_update BEFORE UPDATE ON gps_points BEGIN SELECT RAISE(ABORT,'Raw GPS is immutable'); END;
CREATE TRIGGER raw_gps_delete BEFORE DELETE ON gps_points WHEN EXISTS(SELECT 1 FROM runs WHERE id=OLD.run_id)
 BEGIN SELECT RAISE(ABORT,'Raw GPS deletion requires explicit run deletion'); END;
CREATE TRIGGER raw_event_update BEFORE UPDATE ON run_events BEGIN SELECT RAISE(ABORT,'Raw events are immutable'); END;
CREATE TRIGGER raw_event_delete BEFORE DELETE ON run_events WHEN EXISTS(SELECT 1 FROM runs WHERE id=OLD.run_id)
 BEGIN SELECT RAISE(ABORT,'Raw event deletion requires explicit run deletion'); END;
CREATE TRIGGER completed_gps_insert BEFORE INSERT ON gps_points WHEN (SELECT status FROM runs WHERE id=NEW.run_id)='completed'
 BEGIN SELECT RAISE(ABORT,'Completed Raw GPS is immutable'); END;
CREATE TRIGGER completed_event_insert BEFORE INSERT ON run_events WHEN (SELECT status FROM runs WHERE id=NEW.run_id)='completed'
 BEGIN SELECT RAISE(ABORT,'Completed events are immutable'); END;
`;
export const SCHEMA = V17_SCHEMA + PAGE_SCHEMA;
export function canonical(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, normalize(child)])) : v;
  return JSON.stringify(normalize(value));
}
function chunks(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + 8192, text.length);
    // Never split a surrogate pair: SQLite encodes each parameter separately.
    if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
    out.push(text.slice(i, end)); i = end;
  }
  return out.length ? out : [''];
}
type Header = { id: string; status: 'draft' | 'completed'; started_at: string; ended_at: string | null; distance: number; trashed_at: number | null; effective_distance: number; effective_time: number };
type PartTable = 'run_metadata' | 'run_operations' | 'run_diagnostics';

export class SqliteStore {
  private queue: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private fatal: Error | undefined;
  diagnosticWarning: string | undefined;
  constructor(readonly db: SqlConnection) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.then(() => undefined, () => undefined); return result;
  }
  async initialize() {
    if (this.fatal) throw this.fatal;
    if (this.initialized) return;
    const [{ user_version: version }] = await this.db.getAllAsync<{ user_version: number }>('PRAGMA user_version');
    if (version > SCHEMA_VERSION) throw new Error('未対応のSQLiteスキーマです。変更せず停止します');
    await this.db.execAsync('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;');
    if (version === 0) {
      await this.db.execAsync('BEGIN IMMEDIATE');
      try { await this.db.execAsync(SCHEMA); await this.db.execAsync('PRAGMA user_version=1; COMMIT;'); }
      catch (error) { await this.rollback(error); }
    }
    if (version < 2) {
      await this.db.execAsync('BEGIN IMMEDIATE');
      try { await this.db.execAsync(PAGE_SCHEMA); await migratePageIndex(this.db); await this.db.execAsync('PRAGMA user_version=2; COMMIT;'); }
      catch (error) { await this.rollback(error); }
    }
    const result = await this.db.getAllAsync<{ quick_check: string }>('PRAGMA quick_check');
    if (result.some(row => row.quick_check !== 'ok')) throw new Error('SQLite整合性検証に失敗しました');
    this.initialized = true;
  }
  atomic<T>(fn: (store: SqliteStore) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.initialize(); await this.db.execAsync('BEGIN IMMEDIATE');
      try { const result = await fn(this); await this.db.execAsync('COMMIT'); return result; }
      catch (error) { return this.rollback(error); }
    });
  }
  private async rollback(original: unknown): Promise<never> {
    try { await this.db.execAsync('ROLLBACK'); }
    catch (error) {
      // SQLITE_FULL/IOERR can automatically roll back the entire transaction.
      if (!/no transaction is active/i.test(String(error))) {
        this.fatal = new Error(`SQLiteロールバックを確認できません。追加書き込みを停止します: ${String(original)} / ${String(error)}`);
        throw this.fatal;
      }
    }
    throw original;
  }
  private async writePart(table: PartTable, id: string, value: unknown) {
    const kind = table.slice(4) as StreamKind;
    await this.db.runAsync(`DELETE FROM ${table} WHERE run_id=?`, id);
    await this.db.runAsync('DELETE FROM run_row_hash WHERE run_id=? AND kind=?', id, kind);
    if (value === undefined) return;
    const parts = chunks(canonical(value));
    for (let i = 0; i < parts.length; i++) {
      await this.db.runAsync(`INSERT INTO ${table}(run_id,chunk,payload) VALUES(?,?,?)`, id, i, parts[i]);
      await stampRow(this.db, id, kind, i, parts[i]);
    }
  }
  private async readPart(table: PartTable, id: string): Promise<unknown> {
    const rows = await this.db.getAllAsync<{ chunk: number; payload: string }>(`SELECT chunk,payload FROM ${table} WHERE run_id=? ORDER BY chunk`, id);
    if (!rows.length) return undefined;
    if (rows.some((row, i) => row.chunk !== i)) throw new Error(`SQLiteチャンク欠落: ${id}/${table}`);
    return JSON.parse(rows.map(row => row.payload).join(''));
  }
  /** Internal transaction methods: callers use atomic to serialize and commit. */
  async readRun(id: string): Promise<ActiveRun | null> {
    const [header] = await this.db.getAllAsync<Header>('SELECT * FROM runs WHERE id=?', id);
    if (!header) return null;
    const metadata = await this.readPart('run_metadata', id);
    if (!metadata || typeof metadata !== 'object') throw new Error(`記録メタデータ異常: ${id}`);
    const pointRows = await this.db.getAllAsync<{ payload: string }>('SELECT p.payload FROM gps_order o JOIN gps_points p ON p.run_id=o.run_id AND p.seq=o.seq WHERE o.run_id=? ORDER BY o.position', id);
    const events = await this.db.getAllAsync<{ payload: string }>('SELECT payload FROM run_events WHERE run_id=? ORDER BY seq', id);
    const operation = await this.readPart('run_operations', id) as { recovery?: RunRecord['recovery']; stopOverrides?: RunRecord['stopOverrides'] } | undefined;
    const diagnostics = await this.readPart('run_diagnostics', id);
    const run = { ...metadata, points: pointRows.map(row => JSON.parse(row.payload)), ...operation } as ActiveRun;
    // Presence flags retain absent arrays and other original JSON semantics.
    const flags = (metadata as { _sqlitePresence: { events: boolean; diagnostics: boolean; points: number; eventCount: number } })._sqlitePresence;
    if (!flags || flags.points !== pointRows.length || flags.eventCount !== events.length) throw new Error(`GPS/イベント件数不一致: ${id}`);
    delete (run as unknown as Record<string, unknown>)._sqlitePresence;
    if (flags.events) run.events = events.map(row => JSON.parse(row.payload));
    if (diagnostics !== undefined) run.diagnostics = diagnostics as ActiveRun['diagnostics'];
    if (run.id !== header.id || run.startedAt !== header.started_at || (run.endedAt ?? null) !== header.ended_at || run.distanceMeters !== header.distance)
      throw new Error(`記録ヘッダー不一致: ${id}`);
    return run;
  }
  async writeRun(run: ActiveRun, status: 'draft' | 'completed', preserveDiagnostics = false) {
    const [existing] = await this.db.getAllAsync<Header>('SELECT * FROM runs WHERE id=?', run.id);
    if (existing?.status === 'completed' && (status === 'draft' || existing.started_at !== run.startedAt || existing.ended_at !== run.endedAt || existing.distance !== run.distanceMeters)) throw new Error('確定済み走行の元の値を上書きできません');
    const { points, events, diagnostics, recovery, stopOverrides, ...metadata } = run;
    if ('_sqlitePresence' in metadata) throw new Error('予約されたメタデータ名です');
    const effective = effectiveRun(run);
    if (!existing) await this.db.runAsync('INSERT INTO runs(id,status,started_at,ended_at,distance,trashed_at,effective_distance,effective_time,position) VALUES(?,?,?,?,?,?,?,?,(SELECT coalesce(max(position),0)+1 FROM runs))', run.id, 'draft', run.startedAt, run.endedAt ?? null, run.distanceMeters, (run as RunRecord).trashedAt ?? null, effective.distanceMeters, effective.activeRunningTime);
    const [{ total: previousCount }] = await this.db.getAllAsync<{ total: number }>('SELECT count(*) AS total FROM gps_points WHERE run_id=?', run.id);
    const positions = new Map<string, number[]>();
    for (let start = 0; start < previousCount; start += PAGE_ROWS) {
      const rows = await this.db.getAllAsync<{ seq: number; payload: string; hash: string }>("SELECT p.seq,p.payload,h.hash FROM gps_points p LEFT JOIN run_row_hash h ON h.run_id=p.run_id AND h.kind='gps' AND h.seq=p.seq WHERE p.run_id=? AND p.seq>=? ORDER BY p.seq LIMIT ?", run.id, start, PAGE_ROWS);
      if (!rows.length) throw new Error('Raw GPSの欠落を拒否しました');
      for (let i=0;i<rows.length;i++) {
        const point=rows[i], hash=hashText(point.payload);
        if (point.seq!==start+i || hash!==point.hash) throw new Error('Raw GPSの順序・SHA-256異常を拒否しました');
        positions.set(hash,[...(positions.get(hash)??[]),point.seq]);
      }
    }
    const order: number[] = []; let nextSeq = previousCount;
    for (const point of points) {
      const payload = canonical(point), matches = positions.get(hashText(payload));
      const seq = matches?.shift() ?? nextSeq++;
      if (seq >= previousCount) {
        await this.db.runAsync('INSERT INTO gps_points(run_id,seq,payload) VALUES(?,?,?)', run.id, seq, payload);
        await stampRow(this.db, run.id, 'gps', seq, payload);
      }
      order.push(seq);
    }
    if ([...positions.values()].some(values => values.length)) throw new Error('Raw GPSの変更・欠落を拒否しました');
    const oldOrder = await this.db.getAllAsync<{ seq: number }>('SELECT seq FROM gps_order WHERE run_id=? ORDER BY position', run.id);
    if (existing?.status === 'completed' && canonical(oldOrder.map(row => row.seq)) !== canonical(order)) throw new Error('確定済みRaw GPSの順序変更を拒否しました');
    const prefix = oldOrder.every((row, i) => row.seq === order[i]);
    if (prefix) {
      for (let i = oldOrder.length; i < order.length; i++) await this.db.runAsync('INSERT INTO gps_order(run_id,position,seq) VALUES(?,?,?)', run.id, i, order[i]);
    } else if (canonical(oldOrder.map(row => row.seq)) !== canonical(order)) {
      await this.db.runAsync('DELETE FROM gps_order WHERE run_id=?', run.id);
      for (let i = 0; i < order.length; i++) await this.db.runAsync('INSERT INTO gps_order(run_id,position,seq) VALUES(?,?,?)', run.id, i, order[i]);
    }
    const [{total:oldEventCount}] = await this.db.getAllAsync<{total:number}>('SELECT count(*) AS total FROM run_events WHERE run_id=?',run.id);
    for(let start=0;start<oldEventCount;start+=PAGE_ROWS){
      const rows=await this.db.getAllAsync<{seq:number;payload:string}>('SELECT seq,payload FROM run_events WHERE run_id=? AND seq>=? ORDER BY seq LIMIT ?',run.id,start,PAGE_ROWS);
      if(!rows.length||rows.some((row,i)=>row.seq!==start+i||row.payload!==canonical(events?.[start+i])))throw new Error('元イベントの変更・欠落を拒否しました');
    }
    for (let i = oldEventCount; i < (events?.length ?? 0); i++) {
      const payload = canonical(events![i]);
      await this.db.runAsync('INSERT INTO run_events(run_id,seq,payload) VALUES(?,?,?)', run.id, i, payload);
      await stampRow(this.db, run.id, 'events', i, payload);
    }
    await this.writePart('run_metadata', run.id, { ...metadata, _sqlitePresence: { events: events !== undefined, diagnostics: diagnostics !== undefined, points: points.length, eventCount: events?.length ?? 0 } });
    await this.writePart('run_operations', run.id, recovery !== undefined || stopOverrides !== undefined ? { recovery, stopOverrides } : undefined);
    if (preserveDiagnostics) {
      if (diagnostics !== undefined && new TextEncoder().encode(canonical(diagnostics)).byteLength > 4 * 1024 * 1024) throw new Error('移行Diagnosticsが4MiBを超えています。原データを保持して停止します');
      await this.writePart('run_diagnostics', run.id, diagnostics);
    }
    await this.db.runAsync('UPDATE runs SET status=?,started_at=?,ended_at=?,distance=?,trashed_at=?,effective_distance=?,effective_time=? WHERE id=?', status, run.startedAt, run.endedAt ?? null, run.distanceMeters, (run as RunRecord).trashedAt ?? null, effective.distanceMeters, effective.activeRunningTime, run.id);
    await this.db.runAsync('INSERT OR REPLACE INTO run_stream_state(run_id,points,events,error) VALUES(?,?,?,NULL)', run.id, points.length, events?.length ?? 0);
  }
  getRun(id: string) { return this.atomic(s => s.readRun(id)); }
  async saveDraft(run: ActiveRun) { await this.atomic(async s => {
    const rows = await s.db.getAllAsync<{ run_id: string }>('SELECT run_id FROM active_run');
    if (rows.length && rows[0].run_id !== run.id) throw new Error('別のdraftが存在します');
    await s.writeRun(run, 'draft'); await s.db.runAsync('INSERT OR IGNORE INTO active_run(slot,run_id) VALUES(1,?)', run.id);
  }); await this.saveDiagnostics(run.id,run.diagnostics); }
  private async saveDiagnostics(id: string, diagnostics: ActiveRun['diagnostics']) {
    let bounded = diagnostics;
    if (diagnostics !== undefined && new TextEncoder().encode(canonical(diagnostics)).byteLength > 4 * 1024 * 1024) {
      bounded = { entries: [], counts: { SQLITE_DIAGNOSTICS_LIMIT_REACHED: 1 }, processed: diagnostics.processed };
      this.diagnosticWarning = 'Diagnosticsの容量制限に達しました。GPS・走行記録は保持しています';
    }
    try { await this.atomic(s => s.writePart('run_diagnostics',id,bounded)); }
    catch (error) { this.diagnosticWarning = `Diagnostics保存失敗。GPS・走行記録は確定済みです: ${String(error)}`; }
  }
  getDraft() { return this.atomic(async s => { const rows = await s.db.getAllAsync<{ run_id: string }>('SELECT run_id FROM active_run'); return rows.length ? s.readRun(rows[0].run_id) : null; }); }
  clearDraft() { return this.atomic(async s => {
    const rows = await s.db.getAllAsync<{ run_id: string }>('SELECT run_id FROM active_run');
    await s.db.runAsync('DELETE FROM active_run');
    if (rows.length) await s.db.runAsync("DELETE FROM runs WHERE id=? AND status='draft'", rows[0].run_id);
  }); }
  async complete(run: RunRecord) { const result = await this.atomic(async s => {
    const rows = await s.db.getAllAsync<Header>('SELECT * FROM runs WHERE id=?', run.id);
    const saved = rows[0]?.status === 'completed' ? await s.readRun(run.id) : null;
    if (!saved) { await s.writeRun(run, 'completed'); await s.db.runAsync('UPDATE runs SET position=(SELECT coalesce(min(position),0)-1 FROM runs) WHERE id=?',run.id); }
    await s.db.runAsync('DELETE FROM active_run WHERE run_id=?', run.id);
    return { record: (saved ?? run) as RunRecord, newlySaved: !saved };
  }); if (result.newlySaved) await this.saveDiagnostics(run.id,run.diagnostics); return result.record; }
  list(includeTrash = false, onlyTrash = false) { return this.atomic(async s => {
    const ids = await s.db.getAllAsync<{ id: string }>(`SELECT id FROM runs WHERE status='completed' ${onlyTrash ? 'AND trashed_at IS NOT NULL' : includeTrash ? '' : 'AND trashed_at IS NULL'} ORDER BY ${includeTrash && !onlyTrash ? 'position' : 'started_at DESC,position'}`);
    const out: RunRecord[] = []; for (const row of ids) out.push((await s.readRun(row.id)) as RunRecord); return out;
  }); }
  summaries(limit = 100, offset = 0) { return this.atomic(s => s.db.getAllAsync<Header>("SELECT * FROM runs WHERE status='completed' AND trashed_at IS NULL ORDER BY started_at DESC,position LIMIT ? OFFSET ?", limit, offset)); }
  update(id: string, fn: (run: RunRecord) => RunRecord) { return this.atomic(async s => {
    const run = await s.readRun(id); if (!run?.endedAt) throw new Error('記録が見つかりません');
    const updated = fn(run as RunRecord); await s.writeRun(updated, 'completed'); return updated;
  }); }
  remove(id: string) { return this.atomic(async s => {
    const rows = await s.db.getAllAsync<Header>('SELECT * FROM runs WHERE id=?', id);
    if (rows.length && rows[0].trashed_at === null) throw new Error('完全削除できるのはごみ箱の記録だけです');
    await s.db.runAsync('DELETE FROM runs WHERE id=?', id);
  }); }
  purgeTrash(before: number) { return this.atomic(async s => {
    const ids = await s.db.getAllAsync<{ id: string }>("SELECT id FROM runs WHERE status='completed' AND protected=0 AND trashed_at>=0 AND trashed_at<=?", before);
    for (const row of ids) await s.db.runAsync('DELETE FROM runs WHERE id=?', row.id); return ids.length;
  }); }
  importRuns(runs: RunRecord[]) { return this.atomic(async s => {
    let added = 0, skipped = 0;
    for (const run of runs) {
      const existing = await s.db.getAllAsync<Header>('SELECT * FROM runs WHERE id=?', run.id);
      if (existing[0]?.status === 'draft') throw new Error('進行中の記録とIDが一致します');
      if (existing.length) { skipped++; continue; }
      await s.writeRun(run, 'completed', true); added++;
    }
    return { added, skipped };
  }); }
  async readSetting(key: string) {
    const rows = await this.db.getAllAsync<{ chunk: number; payload: string }>('SELECT chunk,payload FROM settings WHERE key=? ORDER BY chunk', key);
    if (rows.some((row,i) => row.chunk !== i)) throw new Error(`設定チャンク欠落: ${key}`);
    return rows.length ? rows.map(row => row.payload).join('') : null;
  }
  async writeSetting(key: string, value: string | null) {
    if (key.length > 256) throw new Error('設定キーが長すぎます');
    await this.db.runAsync('DELETE FROM settings WHERE key=?', key);
    if (value !== null) for (const [i, text] of chunks(value).entries()) await this.db.runAsync('INSERT INTO settings(key,chunk,payload) VALUES(?,?,?)', key, i, text);
  }
  getSetting(key: string) { return this.atomic(s => s.readSetting(key)); }
  setSetting(key: string, value: string | null) { return this.atomic(s => s.writeSetting(key, value)); }
  snapshot(): Promise<SqlSnapshot> { return this.atomic(async s => {
    const ids = await s.db.getAllAsync<{ id: string }>("SELECT id FROM runs WHERE status='completed' ORDER BY position");
    const runs: RunRecord[] = []; for (const row of ids) runs.push((await s.readRun(row.id)) as RunRecord);
    const active = await s.db.getAllAsync<{ run_id: string }>('SELECT run_id FROM active_run');
    const keys = await s.db.getAllAsync<{ key: string }>('SELECT DISTINCT key FROM settings ORDER BY key');
    const settings: Record<string, string> = {}; for (const row of keys) settings[row.key] = (await s.readSetting(row.key))!;
    const protectedRows = await s.db.getAllAsync<{ id: string }>('SELECT id FROM runs WHERE protected=1 ORDER BY position');
    return { runs, draft: active.length ? await s.readRun(active[0].run_id) : null, settings, protectedIds: protectedRows.map(row => row.id) };
  }); }
  restore(snapshot: SqlSnapshot, source?: string) { return this.atomic(async s => {
    let added = 0, skipped = 0;
    for (const run of snapshot.runs) {
      const [existing] = await s.db.getAllAsync<Header>('SELECT * FROM runs WHERE id=?', run.id);
      if (existing?.status === 'draft') throw new Error('既存draftとIDが衝突しています');
      if (existing) { skipped++; continue; }
      await s.writeRun(run, 'completed', true); added++;
    }
    if (snapshot.draft) {
      const run = snapshot.draft;
      const existing = await s.readRun(run.id);
      const [active] = await s.db.getAllAsync<{ run_id: string }>('SELECT run_id FROM active_run');
      if (active && active.run_id !== run.id) throw new Error('別のdraftが存在するため復元を中止しました');
      if (existing && canonical(existing) !== canonical(run)) throw new Error('draftのID衝突です。上書きせず停止しました');
      if (!existing) {
        await s.writeRun(run, 'draft', true); await s.db.runAsync('INSERT INTO active_run(slot,run_id) VALUES(1,?)', run.id);
      }
    }
    for (const [key, value] of Object.entries(snapshot.settings)) if (await s.readSetting(key) === null) await s.writeSetting(key, value);
    for (const id of snapshot.protectedIds ?? (source ? [...snapshot.runs.map(run => run.id), ...(snapshot.draft ? [snapshot.draft.id] : [])] : [])) await s.db.runAsync('UPDATE runs SET protected=1 WHERE id=?',id);
    if (source) await s.db.runAsync('INSERT OR IGNORE INTO migration_log(source,report) VALUES(?,?)', source, JSON.stringify({ added, skipped, draft: snapshot.draft?.id ?? null, rule: 'preserve-ended-draft-no-auto-complete' }));
    return { added, skipped };
  }); }
  pruneDiagnostics(before: string) { return this.atomic(async s => {
    await s.db.runAsync("DELETE FROM run_row_hash WHERE kind='diagnostics' AND run_id IN(SELECT id FROM runs WHERE status='completed' AND ended_at<?)", before);
    const rows = await s.db.getAllAsync<{ rows: number; bytes: number }>("SELECT count(*) AS rows,coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes FROM run_diagnostics WHERE run_id IN(SELECT id FROM runs WHERE status='completed' AND ended_at<?)", before);
    await s.db.runAsync("DELETE FROM run_diagnostics WHERE run_id IN(SELECT id FROM runs WHERE status='completed' AND ended_at<?)", before);
    return rows[0];
  }); }
}
