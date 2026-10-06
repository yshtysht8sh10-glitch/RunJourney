// Historical v3 audit contracts; current movement semantics are tested in movement-inference.test.ts.
import { ActiveRun, LocationPoint } from '@/types/run';
import { announcementClock, detectStopV3 as detectStop, effectiveDistance, effectiveTimeline, paceTime, stateOf, transition } from '@/utils/run-model';
import { analyzePoints } from '@/utils/pace-analysis';
const point = (timestamp: number, meters = 0, speed = 0, accuracy = 5): LocationPoint => ({ latitude: 35 + meters / 111195, longitude: 139, timestamp, speed, accuracy });
const initial = (): ActiveRun => ({ id: 'latency', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 0, points: [], events: [], features: { autoStop: true, break: true } });
function fix(run: ActiveRun, p: LocationPoint) { const next = detectStop(run, p); next.points = [...run.points, p]; next.distanceMeters = effectiveDistance(next); return next; }
function stopped() { return fix(fix(initial(), point(10000)), point(15000)); }
test('4.9s candidate is provisional; 5s confirms at candidate start, not confirmation', () => {
  let run = fix(initial(), point(10000));
  run = fix(run, point(14900, 1));
  expect(stateOf(run)).toBe('RUNNING');
  expect(run.events).toEqual([]);
  expect(run.detector?.stillSince).toBe(10000);
  expect(paceTime(run, 14900)).toBe(14900);
  run = fix(run, point(15000, 1));
  expect(stateOf(run)).toBe('AUTO_STOP');
  expect(run.events?.at(-1)).toMatchObject({ timestamp: 10000, confirmedAt: 15000, state: 'AUTO_STOP' });
  expect(paceTime(run, 15000)).toBe(10000);
});
test('confirmed stop removes waiting-window jitter distance without deleting raw points', () => {
  let run = fix(initial(), point(10000));
  run = fix(run, point(14000, 4));
  expect(run.distanceMeters).toBeGreaterThan(3);
  run = fix(run, point(15000, 7));
  expect(run.distanceMeters).toBe(0);
  expect(run.points).toHaveLength(3);
  expect(run.points[1]).toEqual(point(14000, 4));
});
test('two-second slowdown cancels completely, including its time and distance', () => {
  let run = fix(initial(), point(10000));
  run = fix(run, point(12000, 2));
  run = fix(run, point(13000, 5, 3));
  expect(stateOf(run)).toBe('RUNNING');
  expect(run.detector?.stillSince).toBeUndefined();
  expect(run.events).toEqual([]);
  expect(paceTime(run, 13000)).toBe(13000);
});
test('resume confirms AND thresholds with consecutive fixes, restores candidate time and movement edges', () => {
  let run = stopped();
  run = fix(run, point(20000, 4, 1.5));
  expect(stateOf(run)).toBe('AUTO_STOP');
  expect(run.detector?.movement).toMatchObject({ startedAt: 20000, origin: point(20000, 4, 1.5), fixes: 1 });
  run = fix(run, point(25000, 12, 1.6));
  expect(stateOf(run)).toBe('RUNNING');
  expect(run.events?.at(-1)).toMatchObject({ timestamp: 20000, confirmedAt: 25000, state: 'RUNNING' });
  expect(paceTime(run, 25000)).toBe(15000);
  expect(run.distanceMeters).toBeCloseTo(8, 0); // No bridge from the stopped anchor.
});
test('single moving spike / slow jitter cancels resume candidate without adding an event', () => {
  let run = fix(stopped(), point(20000, 12, 2.4));
  expect(stateOf(run)).toBe('AUTO_STOP');
  run = fix(run, point(25000, 14, 0.2));
  expect(run.detector?.movement).toBeUndefined();
  run = fix(run, point(30000, 18, 1.5));
  run = fix(run, point(35000, 26, 1.6));
  expect(run.events?.at(-1)?.timestamp).toBe(30000);
});
test.each(['accuracy', 'gap'])('resume evidence is held for accuracy loss, re-anchored after a gap (%s)', reason => {
  let run = fix(stopped(), point(20000, 4, 1.5));
  run = reason === 'accuracy' ? fix(run, point(25000, 200, 2, 100)) : fix(run, point(40000, 20, 2));
  expect(stateOf(run)).toBe('AUTO_STOP');
  if (reason === 'accuracy') expect(run.detector?.movement?.startedAt).toBe(20000);
  else expect(run.detector?.movement).toBeUndefined();
});
test('Auto Stop OFF never starts candidates or adjusts time', () => {
  let run: ActiveRun = { ...initial(), features: { autoStop: false, break: true } };
  run = fix(fix(run, point(10000)), point(15000, 4));
  expect(run.detector).toBeUndefined(); expect(run.events).toEqual([]);
  expect(paceTime(run, 15000)).toBe(15000);
});
test('BREAK operations use exact user timestamps and discard sensor candidates', () => {
  let run = fix(initial(), point(10000));
  run = transition(run, 'BREAK', 12000, 'user');
  run = fix(run, point(17000, 100, 2));
  expect(stateOf(run)).toBe('BREAK');
  run = transition(run, 'RUNNING', 18000, 'user');
  expect(run.events?.map(e => e.timestamp)).toEqual([12000, 18000]);
  expect(run.events?.every(e => e.confirmedAt === undefined)).toBe(true);
  expect(paceTime(run, 20000)).toBe(14000);
});
test('stop and movement candidates survive draft serialization and confirm at original start', () => {
  let run = JSON.parse(JSON.stringify(fix(initial(), point(10000)))) as ActiveRun;
  run = fix(run, point(15000));
  run = fix(run, point(20000, 4, 1.5));
  run = JSON.parse(JSON.stringify(run));
  run = fix(run, point(25000, 12, 1.6));
  expect(run.events?.map(e => e.timestamp)).toEqual([10000, 20000]);
});
test('legacy 20s candidate is discarded without changing already committed events', () => {
  const run = { ...initial(), detector: { stillSince: 0, last: point(15000), anchor: point(0) } };
  const updated = fix(run, point(20000));
  expect(stateOf(updated)).toBe('RUNNING');
  expect(updated.detector?.stillSince).toBe(20000);
});
function fiveMinuteRun() {
  let run = fix(initial(), point(235000, 0, 2));
  run = fix(run, point(240000));
  run = fix(run, point(245000, 3));
  expect(paceTime(run, 245000)).toBe(240000);
  run = fix(run, point(355000));
  run = fix(run, point(360000, 4, 1.5));
  run = fix(run, point(365000, 12, 1.6));
  run = fix(run, point(420000, 122, 2));
  return run;
}
test('4min running / 2min stop / 1min running makes exactly five active minutes', () => {
  const run = fiveMinuteRun();
  expect(paceTime(run, 420000)).toBe(300000);
  expect(announcementClock(run, 420000).confirmedActiveMs).toBe(300000);
  const lap = analyzePoints(effectiveTimeline(run), 0, 300000);
  expect(lap?.durationMs).toBe(300000);
  expect(lap?.distanceMeters).toBeCloseTo(effectiveDistance(run), 6);
  expect(Number.isFinite(lap?.secondsPerKm)).toBe(true);
});
test('pending stop at 4:59 cannot prematurely publish the five-minute voice interval', () => {
  const run = fix(initial(), point(299000));
  expect(paceTime(run, 303900)).toBe(303900); // UI remains provisional.
  expect(announcementClock(run, 303900).confirmedActiveMs).toBe(299000);
  const confirmed = fix(run, point(304000));
  expect(paceTime(confirmed, 304000)).toBe(299000);
});

test('GPS speed unavailable uses displacement speed for confirmed resume', () => {
  let run = stopped();
  run = fix(run, { ...point(20000, 7), speed: undefined });
  expect(stateOf(run)).toBe('AUTO_STOP');
  run = fix(run, { ...point(25000, 15), speed: undefined });
  expect(stateOf(run)).toBe('RUNNING');
  expect(run.events?.at(-1)?.timestamp).toBe(20000);
});
test('a slow resume fix beyond 10m fails the AND speed condition', () => {
  const run = fix(stopped(), point(20000, 12, 0.4));
  expect(stateOf(run)).toBe('AUTO_STOP');
  expect(run.detector?.movement).toBeUndefined();
});
