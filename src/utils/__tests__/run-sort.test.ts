import type { RunSummary } from '@/domain/pages';
import { DEFAULT_RUN_SORT, nextRunSort, sortRunRows } from '@/web/run-sort';

function row(id: string, day: number, distance: number, moving: number): RunSummary {
  const start = Date.UTC(2026, 9, day);
  return { kind: 'run-summary', id, startedAt: new Date(start).toISOString(), endedAt: new Date(start + moving).toISOString(), distanceMeters: distance, originalDistanceMeters: distance, activeRunningTime: moving, wallClockElapsed: moving, pointCount: 0, counts: { gps: 0, events: 0, metadata: 0, operations: 0, diagnostics: 0 } };
}
const ids = (rows: RunSummary[]) => rows.map(r => r.id);
const a = row('a', 1, 2000, 60000), b = row('b', 2, 10000, 3600000), c = row('c', 3, 0, 0);
test('default date order is newest first without changing source or reading GPS', () => {
  const input = [a, b, c].map(r => Object.defineProperty({ ...r }, 'points', { get: () => { throw Error('GPS must not be read'); } }));
  expect(ids(sortRunRows(input, DEFAULT_RUN_SORT, '検証済み'))).toEqual(['c', 'b', 'a']);
  expect(ids(input)).toEqual(['a', 'b', 'c']);
});
test.each(['distance', 'moving', 'elapsed'] as const)('%s compares numbers rather than formatted labels', key => {
  expect(ids(sortRunRows([a, b, c], { key, direction: 'asc' }, ''))).toEqual(['c', 'a', 'b']);
  expect(ids(sortRunRows([a, b, c], { key, direction: 'desc' }, ''))).toEqual(['b', 'a', 'c']);
});
test('pace and speed put unavailable metrics last in both directions', () => {
  expect(ids(sortRunRows([a, c, b], { key: 'pace', direction: 'asc' }, ''))).toEqual(['a', 'b', 'c']);
  expect(ids(sortRunRows([a, c, b], { key: 'pace', direction: 'desc' }, ''))).toEqual(['b', 'a', 'c']);
  expect(ids(sortRunRows([a, c, b], { key: 'speed', direction: 'asc' }, ''))).toEqual(['b', 'a', 'c']);
  expect(ids(sortRunRows([a, c, b], { key: 'speed', direction: 'desc' }, ''))).toEqual(['a', 'b', 'c']);
});
test('column changes and repeated clicks select predictable directions', () => {
  expect(nextRunSort(DEFAULT_RUN_SORT, 'startedAt')).toEqual({ key: 'startedAt', direction: 'asc' });
  expect(nextRunSort(DEFAULT_RUN_SORT, 'distance')).toEqual({ key: 'distance', direction: 'asc' });
  expect(nextRunSort(DEFAULT_RUN_SORT, 'endedAt')).toEqual({ key: 'endedAt', direction: 'desc' });
});
test('same values have deterministic date/id ties; sorting happens before pagination', () => {
  expect(ids(sortRunRows([a, b, c], { key: 'status', direction: 'asc' }, '検証済み'))).toEqual(['c', 'b', 'a']);
  const input = Array.from({ length: 101 }, (_, i) => row(String(i + 1), 1, i + 1, 60000));
  const sorted = sortRunRows(input, { key: 'distance', direction: 'desc' }, '');
  expect(sorted.slice(0, 50).map(r => r.distanceMeters)).toEqual(Array.from({ length: 50 }, (_, i) => 101 - i));
});
