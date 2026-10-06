import { ActiveRun, LocationPoint } from '@/types/run';
import { detectStop, stateOf, transition } from '@/utils/run-model';

const p = (t: number, m: number, speed: number | undefined = 2, accuracy = 5): LocationPoint => ({ timestamp: t * 1000, latitude: 35 + m / 111195, longitude: 139, accuracy, speed });
const base = (): ActiveRun => ({ id: 'synthetic', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0, features: { autoStop: true, break: true }, diagnostics: { entries: [], counts: {}, processed: 0 } });
function feed(points: LocationPoint[], run = base()) { return points.reduce((r, point) => detectStop(r, point, 'live-observation'), run); }
const series = (start: number, end: number, dt: number, location: (t: number) => number, speed?: number) => Array.from({ length: Math.floor((end - start) / dt) + 1 }, (_, i) => p(start + i * dt, location(start + i * dt), speed));

test.each([1, 5])('%ss input: stop, run at 2m/s and never remain stopped for tens of seconds', dt => {
  let run = feed(series(0, 15, dt, () => 0, 0));
  expect(stateOf(run)).toBe('AUTO_STOP');
  run = feed(series(15 + dt, 75, dt, t => (t - 15) * 2), run);
  expect(stateOf(run)).toBe('RUNNING');
  expect(run.events).toHaveLength(2);
  expect(run.events?.[1].timestamp).toBe(15000);
  expect(run.events?.[1].confirmedAt! - 15000).toBeLessThanOrEqual(10000);
});
test.each([1, 5])('%ss continuous running and 3.5km/h walking do not auto stop', dt => {
  for (const velocity of [2, 3.5 / 3.6]) expect(feed(series(0, 60, dt, t => t * velocity)).events ?? []).toHaveLength(0);
});
test('stop after running; bouncing with high speed stays stopped', () => {
  let run = feed(series(0, 20, 1, t => t * 2));
  run = feed(series(21, 40, 1, () => 40, 0), run);
  expect(stateOf(run)).toBe('AUTO_STOP');
  expect(run.events?.[0].timestamp).toBe(20000);
  run = feed(series(41, 60, 1, t => 40 + (t % 2) * 0.7, 2), run);
  expect(stateOf(run)).toBe('AUTO_STOP');
});
test('one GPS jump does not resume; later normal movement does', () => {
  let run = feed(series(0, 10, 1, () => 0, 0));
  run = feed([p(11, 30), p(12, 0), p(13, 0)], run);
  expect(stateOf(run)).toBe('AUTO_STOP');
  run = feed(series(14, 40, 1, t => (t - 13) * 2), run);
  expect(stateOf(run)).toBe('RUNNING');
});
test('poor accuracy cannot prove movement; missing or briefly low speed does not reset forward motion', () => {
  const stopped = feed(series(0, 10, 1, () => 0, 0));
  expect(stateOf(feed(series(11, 30, 1, t => t * 2).map(point => ({ ...point, accuracy: 100 })), stopped))).toBe('AUTO_STOP');
  for (const missing of [true, false]) {
    const points = series(11, 30, 1, t => (t - 10) * 2).map((point, i) => ({ ...point, speed: missing ? undefined : i === 3 ? 0.1 : 2 }));
    expect(stateOf(feed(points, stopped))).toBe('RUNNING');
  }
});
test('Break never auto resumes; window survives draft serialization', () => {
  let run = transition(base(), 'BREAK', 0, 'user');
  expect(stateOf(feed(series(1, 30, 1, t => t * 2), run))).toBe('BREAK');
  run = feed(series(0, 3, 1, () => 0, 0));
  run = JSON.parse(JSON.stringify(run));
  run = feed(series(4, 6, 1, () => 0, 0), run);
  expect(run.events?.[0]).toMatchObject({ timestamp: 0, confirmedAt: 5000 });
});
test('diagnostics record source, coordinate-free window and confirmed/effective times', () => {
  const run = feed(series(0, 6, 1, () => 0, 0));
  const entry = run.diagnostics?.entries.find(e => e.decision === 'STOP_CONFIRMED');
  expect(entry).toMatchObject({ inputSource: 'live-observation', effectiveTimestamp: 0, confirmedAt: 5000, window: { durationMs: 5000, validCount: 6 } });
  expect(JSON.stringify(run.diagnostics)).not.toMatch(/latitude|longitude/);
});
test('irregular persisted 5–6s gate samples can resume without exact 10s alignment', () => {
  let run = base();
  for (const t of [0, 5.4, 10.8]) run = detectStop(run, p(t, 0, 0), 'replay');
  expect(stateOf(run)).toBe('AUTO_STOP');
  for (const t of [16.2, 21.6, 27, 32.4]) run = detectStop(run, p(t, (t - 10.8) * 2), 'replay');
  expect(stateOf(run)).toBe('RUNNING');
  expect(run.events?.[1]).toMatchObject({ timestamp: 10800, confirmedAt: 21600 });
});
