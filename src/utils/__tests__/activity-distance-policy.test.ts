/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { RUNNING_PROFILE, CYCLING_PROFILE, GENERIC_PROFILE, activityDatabaseName, measurementProfile, type ActivityKind } from '@/domain/measurement-profile';
import { calculateDistance } from '@/utils/distance';
import { effectiveDistance, effectiveRun } from '@/utils/run-model';
import { SqliteStore, type SqlConnection } from '@/repositories/sqlite-store';
import type { LocationPoint, RunRecord } from '@/types/run';

const point = (timestamp: number, meters: number, accuracy = 5): LocationPoint => ({ latitude: meters / 111195, longitude: 0, timestamp, accuracy });
const run = (points: LocationPoint[]): RunRecord => ({ id: 'same-id', startedAt: new Date(0).toISOString(),
  endedAt: new Date(10000).toISOString(), createdAt: new Date(0).toISOString(), updatedAt: new Date(10000).toISOString(),
  distanceMeters: 0, points, events: [], features: { autoStop: false, break: true } });

test('destinations and capabilities are immutable, allowlisted and reject generic history', () => {
  expect(activityDatabaseName('running')).toBe('runjourney.sqlite');
  expect(activityDatabaseName('cycling')).toBe('runjourney-cycling.sqlite');
  expect(() => activityDatabaseName('generic' as ActivityKind)).toThrow();
  expect(() => measurementProfile('../runjourney.sqlite' as ActivityKind)).toThrow();
  expect(GENERIC_PROFILE.databaseName).toBeNull();
  expect(Object.values(GENERIC_PROFILE.features)).toEqual([false, false, false, false, false]);
  expect(CYCLING_PROFILE.features.pace).toBe(false);
  expect(CYCLING_PROFILE.features.cloudSync).toBe(false);
  expect(Object.isFrozen(CYCLING_PROFILE.distance)).toBe(true);
});

test.each([0, 5, 12, 15, 25, 29])('same GPS input at %sm/s preserves default Running output, with Cycling range', speed => {
  const points = [point(0, 0), point(10000, speed * 10000 / 1000)];
  const original = calculateDistance(points);
  expect(calculateDistance(points, RUNNING_PROFILE.distance)).toBe(original);
  expect(effectiveDistance(run(points))).toBe(effectiveDistance(run(points), RUNNING_PROFILE.distance));
  const cycling = calculateDistance(points, CYCLING_PROFILE.distance);
  expect(cycling).toBeCloseTo(speed * 10, 0);
  if (speed > 12.5) expect(original).toBe(0);
});

test('Cycling rejects spikes, long gaps, invalid/poor points and stale edges without invented distance', () => {
  for (const points of [[point(0, 0), point(1000, 100)], [point(0, 0), point(16000, 40)],
    [point(0, 0), point(5000, 30, 100)], [point(1000, 0), point(1000, 30)],
    [point(0, 0), { ...point(5000, 30), latitude: NaN }]]) {
    expect(calculateDistance(points, CYCLING_PROFILE.distance)).toBe(0);
  }
  const longGap = [point(0, 0), point(16000, 40)];
  expect(calculateDistance(longGap)).toBeGreaterThan(0); // Existing Running semantics preserved.
});

test('shared effective clock excludes manual breaks identically for both policies', () => {
  const active = { ...run(Array.from({ length: 11 }, (_, i) => point(i * 1000, i * 5))),
    events: [{ timestamp: 3000, state: 'BREAK' as const, source: 'user' as const },
      { timestamp: 6000, state: 'RUNNING' as const, source: 'user' as const }] };
  const r = effectiveRun(active), c = effectiveRun(active, undefined, CYCLING_PROFILE.distance);
  expect(c.activeRunningTime).toBe(7000);
  expect(c.distanceMeters).toBe(r.distanceMeters);
});

test('independent SQLite stores retain same IDs, settings and raw GPS; Cycling headers never recalculate with Running cap', async () => {
  const natives = [new DatabaseSync(':memory:'), new DatabaseSync(':memory:')];
  const connection = (native: DatabaseSync): SqlConnection => ({
    execAsync: async sql => { native.exec(sql); },
    runAsync: async (sql, ...params) => native.prepare(sql).run(...params),
    getAllAsync: async <T,>(sql: string, ...params: (string | number | null)[]) => native.prepare(sql).all(...params) as T[],
  });
  try {
    const running = new SqliteStore(connection(natives[0]));
    const cycling = new SqliteStore(connection(natives[1]), CYCLING_PROFILE.distance);
    const raw = run([point(0, 0), point(5000, 100), point(10000, 200)]);
    await running.saveDraft(raw); await cycling.saveDraft(raw);
    await running.complete(raw); await cycling.complete(raw);
    await running.setSetting('voice', 'running-original'); await cycling.setSetting('voice', 'cycling-only');
    expect((await running.summaries())[0].effective_distance).toBe(0);
    expect((await cycling.summaries())[0].effective_distance).toBeCloseTo(200, 0);
    expect((await cycling.getRun(raw.id))?.points).toEqual(raw.points);
    expect((await running.getRun(raw.id))?.points).toEqual(raw.points);
    await cycling.update(raw.id, value => ({ ...value, trashedAt: 20000 }));
    expect((await running.summaries()).length).toBe(1);
    expect((await cycling.summaries()).length).toBe(0);
    await cycling.remove(raw.id);
    expect(await running.getSetting('voice')).toBe('running-original');
    expect(await cycling.getSetting('voice')).toBe('cycling-only');
    expect(await running.getRun(raw.id)).not.toBeNull();
    expect(await cycling.getRun(raw.id)).toBeNull();
  } finally { natives.forEach(native => native.close()); }
});
