import { cyclingMetrics } from '@/domain/cycling-metrics';
import type { ActiveRun } from '@/types/run';
const run: ActiveRun = { id: 'synthetic', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 50,
  points: [{ timestamp: 0, latitude: 35, longitude: 139, accuracy: 5 }, { timestamp: 5000, latitude: 35 + 50 / 111195, longitude: 139, accuracy: 5 }], events: [] };
test('current provider speed and distance/active-time average are separate km/h metrics', () => {
  const metrics = cyclingMetrics(run, { ...run.points[1], speed: 20 }, 5000);
  expect(metrics.currentKmh).toBe(72); expect(metrics.averageKmh).toBe(36);
});
test('missing provider speed uses a bounded valid recent edge; stale/poor/future GPS gives no current number', () => {
  expect(cyclingMetrics(run, run.points[1], 5000).currentKmh).toBeCloseTo(36, 0);
  expect(cyclingMetrics(run, run.points[1], 21000).currentKmh).toBeNull();
  expect(cyclingMetrics(run, { ...run.points[1], accuracy: 100 }, 5000).currentKmh).toBeNull();
  expect(cyclingMetrics(run, run.points[1], 1000).currentKmh).toBeNull();
});
test('pause excludes time in the shared model and gives zero current speed while GPS is fresh', () => {
  const paused = { ...run, events: [{ timestamp: 2000, state: 'BREAK' as const, source: 'user' as const }] };
  const value = cyclingMetrics(paused, run.points[1], 5000);
  expect(value.activeRunningTime).toBe(2000); expect(value.currentKmh).toBe(0);
});
