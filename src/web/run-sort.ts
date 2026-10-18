import type { RunSummary } from '../domain/pages';
import { runMetrics } from '../domain/review';

export const RUN_COLUMNS = [
  { key: 'startedAt', label: '走行日 / Run ID' },
  { key: 'endedAt', label: '終了日時' },
  { key: 'distance', label: '総走行距離' },
  { key: 'moving', label: '実走時間' },
  { key: 'elapsed', label: '全経過時間' },
  { key: 'pace', label: '平均ペース' },
  { key: 'speed', label: '平均時速' },
  { key: 'status', label: '同期状態' },
] as const;
export type RunSort = { key: typeof RUN_COLUMNS[number]['key']; direction: 'asc' | 'desc' };
export const DEFAULT_RUN_SORT: RunSort = { key: 'startedAt', direction: 'desc' };
export function nextRunSort(current: RunSort, key: RunSort['key']): RunSort {
  return { key, direction: current.key === key ? (current.direction === 'asc' ? 'desc' : 'asc') : (key === 'startedAt' || key === 'endedAt' ? 'desc' : 'asc') };
}
export function sortRunRows<T extends RunSummary>(rows: readonly T[], sort: RunSort, status: string): T[] {
  // Cache projections once per row; sorting never fetches or examines GPS.
  const projected = rows.map(run => {
    const m = runMetrics(run);
    const values = { startedAt: Date.parse(run.startedAt), endedAt: Date.parse(run.endedAt), distance: m.distanceMeters, moving: m.activeRunningTime, elapsed: m.wallClockElapsed, pace: m.pace.secondsPerKm, speed: m.pace.kmPerHour, status };
    return { run, value: values[sort.key] };
  });
  const missing = (value: number | string | null) => value === null || (typeof value === 'number' && !Number.isFinite(value));
  projected.sort((a, b) => {
    const am = missing(a.value), bm = missing(b.value);
    if (am !== bm) return am ? 1 : -1; // Unavailable metrics stay last in either direction.
    const comparison = am ? 0 : typeof a.value === 'string' && typeof b.value === 'string' ? a.value.localeCompare(b.value) : Number(a.value) - Number(b.value);
    if (comparison) return sort.direction === 'asc' ? comparison : -comparison;
    const date = Date.parse(b.run.startedAt) - Date.parse(a.run.startedAt);
    return (Number.isFinite(date) ? date : 0) || a.run.id.localeCompare(b.run.id);
  });
  return projected.map(p => p.run);
}
