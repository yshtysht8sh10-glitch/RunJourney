import { RunRecord, StopReason } from '@/types/run';

export const BACKUP_FORMAT = 'runjourney-backup';
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export type Backup = { format: typeof BACKUP_FORMAT; schemaVersion: 1; exportedAt: number; app: Record<string, string | number | null>; runs: RunRecord[] };
type ObjectValue = Record<string, unknown>;
const invalid = (path: string): never => { throw new Error(`データ形式が不正です: ${path}`); };
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(path);
  return value as ObjectValue;
}
function number(value: unknown, path: string, minimum = -Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) invalid(path);
}
function date(value: unknown, path: string, allowEmpty = false) {
  if (allowEmpty && value === '') return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) < 0) invalid(path);
}
function epoch(value: unknown, path: string) {
  number(value, path, 0);
  if ((value as number) > 8_640_000_000_000_000) invalid(path);
}
function point(value: unknown, path: string) {
  const p = object(value, path);
  number(p.latitude, `${path}.latitude`, -90); number(p.longitude, `${path}.longitude`, -180);
  if ((p.latitude as number) > 90 || (p.longitude as number) > 180) invalid(path);
  epoch(p.timestamp, `${path}.timestamp`);
  for (const field of ['accuracy', 'altitude', 'speed']) if (p[field] !== undefined) number(p[field], `${path}.${field}`);
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > 1_000_000) return invalid(path);
  return value;
}
const states = ['RUNNING', 'AUTO_STOP', 'BREAK'];
// Bound unknown extension data too; preserve it without silently dropping future metadata.
function jsonValue(value: unknown, depth = 0): void {
  if (depth > 24) invalid('構造が深すぎます');
  if (typeof value === 'number') number(value, 'numeric field');
  else if (Array.isArray(value)) array(value, 'array').forEach(v => jsonValue(v, depth + 1));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid(key);
      if (child !== undefined) jsonValue(child, depth + 1);
    }
  } else if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'boolean') invalid('JSON value');
}
export function validateRuns(values: unknown): asserts values is RunRecord[] {
  const runs = array(values, 'runs');
  if (runs.length > 100_000) invalid('記録数が多すぎます');
  jsonValue(runs);
  runs.forEach((value, index) => {
    const path = `runs[${index}]`, run = object(value, path);
    if (typeof run.id !== 'string' || !run.id.trim() || run.id.length > 256) invalid(`${path}.id`);
    date(run.startedAt, `${path}.startedAt`); date(run.endedAt, `${path}.endedAt`);
    if (Date.parse(run.endedAt as string) < Date.parse(run.startedAt as string)) invalid(`${path}.endedAt`);
    // Empty legacy bookkeeping dates are accepted, but start/end are always required.
    for (const key of ['createdAt', 'updatedAt']) if (run[key] !== undefined) date(run[key], `${path}.${key}`, true);
    number(run.distanceMeters, `${path}.distanceMeters`, 0);
    if (run.trashedAt !== undefined) epoch(run.trashedAt, `${path}.trashedAt`);
    array(run.points, `${path}.points`).forEach((p, i) => point(p, `${path}.points[${i}]`));
    if (run.features !== undefined) {
      const f = object(run.features, `${path}.features`);
      if (typeof f.autoStop !== 'boolean' || typeof f.break !== 'boolean') invalid(`${path}.features`);
    }
    if (run.events !== undefined) {
      let previous = -1;
      array(run.events, `${path}.events`).forEach(value => {
        const e = object(value, `${path}.event`); epoch(e.timestamp, `${path}.event.timestamp`);
        if ((e.timestamp as number) < previous || !states.includes(e.state as string) || !['sensor', 'user'].includes(e.source as string)) invalid(`${path}.event`);
        previous = e.timestamp as number;
        if (e.confirmedAt !== undefined) { epoch(e.confirmedAt, `${path}.confirmedAt`); number(e.confirmedAt, `${path}.confirmedAt`, previous); }
        if (e.reason !== undefined && typeof e.reason !== 'string') invalid(`${path}.reason`);
      });
    }
    if (run.recovery !== undefined) {
      const recovery = object(run.recovery, `${path}.recovery`);
      if (!['window-v4', 'window-v5-stop-dwell'].includes(recovery.algorithm as string)) invalid(`${path}.recovery.algorithm`);
      date(recovery.appliedAt, `${path}.recovery.appliedAt`);
      // Reuse normal event validation without reinterpreting original fields.
      validateRuns([{ ...run, recovery: undefined, detector: undefined, diagnostics: undefined, events: recovery.events }]);
    }
    if (run.stopOverrides !== undefined) Object.values(object(run.stopOverrides, `${path}.stopOverrides`)).forEach(value => {
      const o = object(value, `${path}.override`);
      if (typeof o.included !== 'boolean') invalid(`${path}.included`);
      date(o.updatedAt, `${path}.override.updatedAt`, true);
    });
    if (run.detector !== undefined) {
      const d = object(run.detector, `${path}.detector`);
      if (d.version !== undefined && d.version !== 2 && d.version !== 3 && d.version !== 4) invalid(`${path}.detector.version`);
      for (const key of ['anchor', 'last']) if (d[key] !== undefined) point(d[key], `${path}.detector.${key}`);
      if (d.window !== undefined) array(d.window, `${path}.window`).forEach(p => point(p, `${path}.window.point`));
      if (d.stillSince !== undefined) epoch(d.stillSince, `${path}.stillSince`);
      if (d.movement !== undefined) {
        const m = object(d.movement, `${path}.movement`); point(m.origin, `${path}.origin`);
        epoch(m.startedAt, `${path}.movement.startedAt`); number(m.fixes, `${path}.fixes`, 0);
      }
    }
    if (run.diagnostics !== undefined) {
      const d = object(run.diagnostics, `${path}.diagnostics`);
      number(d.processed, `${path}.processed`, 0);
      Object.values(object(d.counts, `${path}.counts`)).forEach(v => number(v, `${path}.count`, 0));
      array(d.entries, `${path}.entries`).forEach(value => {
        const e = object(value, `${path}.diagnostic`); epoch(e.timestamp, `${path}.diagnostic.timestamp`);
        if (!states.includes(e.state as string) || !['START', 'CONTINUE', 'RESET', 'HOLD', 'SKIP', 'STOP_CONFIRMED', 'RESUME_CONFIRMED'].includes(e.decision as string)) invalid(`${path}.diagnostic`);
        if (e.reason !== undefined && !Object.values(StopReason).includes(e.reason as typeof StopReason[keyof typeof StopReason])) invalid(`${path}.diagnostic.reason`);
        for (const key of ['receivedAt', 'accuracy', 'speed', 'effectiveSpeed', 'displacement', 'originDisplacement', 'intervalMs', 'candidateStartedAt', 'candidateAgeMs']) if (e[key] !== undefined) number(e[key], `${path}.${key}`);
        for (const key of ['receivedAt', 'candidateStartedAt']) if (e[key] !== undefined) epoch(e[key], `${path}.${key}`);
      });
    }
  });
}
export function parseBackup(text: string): Backup {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('バックアップが大きすぎます（上限50MB）');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('JSONが壊れています'); }
  const root = object(parsed, 'root');
  if (root.format !== BACKUP_FORMAT) throw new Error('RunJourney Backupではありません');
  if (root.schemaVersion === undefined) throw new Error('schemaVersionがありません');
  if (root.schemaVersion !== 1) throw new Error('未対応のschemaVersionです');
  epoch(root.exportedAt, 'exportedAt'); object(root.app, 'app'); jsonValue(root.app);
  validateRuns(root.runs);
  return normalizeBackup(migrateBackup(root as Backup));
}
// Version-specific migrations belong here; v1 preserves all original fields/timestamps.
function migrateBackup(backup: Backup): Backup { return backup; }
function normalizeBackup(backup: Backup): Backup { return backup; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function serializeBackup(runs: RunRecord[], app: Backup['app'], exportedAt = Date.now()): string {
  validateRuns(runs); epoch(exportedAt, 'exportedAt'); jsonValue(app);
  const sorted = [...runs].sort((a, b) => a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return JSON.stringify(canonical({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt, app, runs: sorted }), null, 2);
}
export function previewImport(incoming: RunRecord[], existing: RunRecord[]) {
  const ids = new Set(existing.map(run => run.id));
  const additions = incoming.filter(run => { if (ids.has(run.id)) return false; ids.add(run.id); return true; });
  const dates = incoming.map(run => Date.parse(run.startedAt));
  return { total: incoming.length, additions, duplicates: incoming.length - additions.length,
    trash: incoming.filter(run => run.trashedAt !== undefined).length,
    oldest: dates.length ? dates.reduce((a, b) => Math.min(a, b)) : null, newest: dates.length ? dates.reduce((a, b) => Math.max(a, b)) : null };
}
export function exportFilename(kind: 'backup' | 'run', time: number) {
  return `runjourney-${kind}-${new Date(time).toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')}.${kind === 'backup' ? 'json' : 'md'}`;
}
