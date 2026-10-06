import { ActiveRun, LocationPoint, RunRecord } from '@/types/run';
import { completedLapAnalysis, detectStop, effectiveDistance, effectiveRun, stopIntervals, transition } from '@/utils/run-model';
import { timeLapRanges } from '@/utils/pace-analysis';
import { calculateDistance } from '@/utils/distance';

const minute = 60000;
const point = (timestamp: number, meters: number, accuracy = 5): LocationPoint => ({ timestamp, latitude: 35 + meters / 111195, longitude: 139, accuracy, speed: 2 });
const run = (): RunRecord => ({ id: 'partition', startedAt: new Date(0).toISOString(), endedAt: new Date(17.5 * minute).toISOString(), points: Array.from({ length: 212 }, (_, i) => point(i * 5000, i * 12)), distanceMeters: 0, createdAt: '', updatedAt: '', features: { autoStop: true, break: true } });
function assertPartition(record: ActiveRun, now = Date.parse(record.endedAt!)) {
  const effective = effectiveRun(record, now), laps = effective.laps();
  expect(laps.reduce((total, lap) => total + lap.distanceMeters, 0)).toBeCloseTo(effective.distanceMeters, 7);
  expect(effectiveDistance(record)).toBeCloseTo(effective.distanceMeters, 7);
  expect(laps.every(lap => Number.isFinite(lap.distanceMeters) && Number.isFinite(lap.durationMs))).toBe(true);
  return { effective, laps };
}
test('0-5 / 5-10 / 10-15 minutes and partial final lap partition the unrounded total', () => {
  const record = run(), { laps } = assertPartition(record);
  expect(laps.map(lap => [lap.startMs, lap.endMs])).toEqual([[0, 5 * minute], [5 * minute, 10 * minute], [10 * minute, 15 * minute], [15 * minute, 17.5 * minute]]);
  expect(laps[0].distanceMeters).toBeCloseTo(calculateDistance(record.points.slice(0, 61)), 7);
  expect(laps[1].distanceMeters).toBeCloseTo(calculateDistance(record.points.slice(60, 121)), 7);
  expect(laps[2].distanceMeters).toBeCloseTo(calculateDistance(record.points.slice(120, 181)), 7);
});
test.each([5000, 10000])('delivery %sms late cannot include post-boundary GPS in completed lap', delay => {
  const record = run(), before = completedLapAnalysis(record, 5 * minute)!, delayed = completedLapAnalysis(record, 5 * minute + delay)!;
  expect(delayed.index).toBe(1); expect(delayed.lap.startMs).toBe(0); expect(delayed.lap.endMs).toBe(5 * minute);
  expect(delayed.total.distanceMeters).toBe(before.total.distanceMeters);
  expect(delayed.lap.distanceMeters).toBe(before.lap.distanceMeters);
  expect(delayed.total.distanceMeters).toBe(delayed.lap.distanceMeters);
});
test('cached GPS before START and observed edge beyond STOP are proportionally clipped, raw is retained', () => {
  const record = { ...run(), startedAt: new Date(5000).toISOString(), endedAt: new Date(15000).toISOString(), points: [point(0, 0), point(10000, 20), point(20000, 40)] };
  const original = JSON.stringify(record), { effective } = assertPartition(record);
  expect(effective.distanceMeters).toBeCloseTo(20, 0); expect(effective.activeRunningTime).toBe(10000);
  expect(JSON.stringify(record)).toBe(original);
});
test('STOP after last observed GPS counts elapsed time but does not invent remaining distance', () => {
  const record = { ...run(), endedAt: new Date(16 * minute + 1234).toISOString(), points: run().points.filter(p => p.timestamp <= 16 * minute) };
  const { effective, laps } = assertPartition(record);
  expect(laps.at(-1)?.endMs).toBe(16 * minute + 1234);
  expect(effective.distanceMeters).toBeCloseTo(calculateDistance(record.points), 7);
});
test.each(['AUTO_STOP', 'BREAK'] as const)('%s crossing and include/exclude share total, lap and history analysis', state => {
  let record: ActiveRun = transition(run(), state, 4 * minute, 'user');
  record = transition(record, 'RUNNING', 7 * minute, 'user');
  const interval = stopIntervals(record)[0];
  for (const included of [false, true, false]) {
    const edited = { ...record, stopOverrides: { [interval.id]: { included, updatedAt: '' } } };
    const { effective, laps } = assertPartition(edited);
    expect(effective.activeRunningTime).toBe((included ? 17.5 : 14.5) * minute);
    const voice = completedLapAnalysis(edited, 10 * minute)!;
    expect(voice.lap.distanceMeters).toBe(laps[1].distanceMeters);
    expect(voice.lap.secondsPerKm).toBe(laps[1].secondsPerKm);
    expect(voice.lap.kmPerHour).toBe(laps[1].kmPerHour);
    expect(voice.lap.projectedTimeSeconds(42195)).toBe(laps[1].projectedTimeSeconds(42195));
  }
});
test('pending candidate stays running; confirmed stop/resume retroactively re-partitions time and distance', () => {
  let record: ActiveRun = { ...run(), endedAt: undefined, points: [], events: [] };
  const fix = (p: LocationPoint) => { record = detectStop(record, p); record.points = [...record.points, p]; };
  fix({ ...point(299000, 0), speed: 0 });
  expect(effectiveRun(record, 303900).activeRunningTime).toBe(303900);
  fix({ ...point(304000, 1), speed: 0 });
  expect(record.events?.[0]).toMatchObject({ timestamp: 299000, confirmedAt: 304000 });
  expect(effectiveRun(record, 304000).activeRunningTime).toBe(299000);
  fix({ ...point(309000, 7), speed: 1.5 }); fix({ ...point(314000, 15), speed: 1.6 });
  expect(record.events?.at(-1)).toMatchObject({ timestamp: 304000, confirmedAt: 314000 });
  const { effective } = assertPartition({ ...record, endedAt: new Date(314000).toISOString() });
  expect(effective.distanceMeters).toBeCloseTo(14, 0); expect(effective.activeRunningTime).toBe(309000);
});
test('GPS filter rejects inaccurate/spike/nonfinite fixes before both total and lap calculation', () => {
  const record = run(); record.points[50] = { ...record.points[50], accuracy: 100 };
  record.points[80] = { ...record.points[80], latitude: 40 }; record.points[100] = { ...record.points[100], timestamp: Infinity };
  const { effective } = assertPartition(record);
  expect(effective.distanceMeters).toBeLessThan(calculateDistance(run().points));
});
test('legacy record with no events/overrides has the same valid filtered GPS distance', () => {
  const record = { ...run(), features: undefined };
  expect(assertPartition(record).effective.distanceMeters).toBeCloseTo(calculateDistance(record.points.filter(p => p.timestamp <= Date.parse(record.endedAt))), 7);
});
test.each([0, 0.001, 2.9])('zero/near-zero movement %sm never creates invalid derived values', meters => {
  const record = { ...run(), points: [point(0, 0), point(5000, meters)] };
  const { effective, laps } = assertPartition(record);
  expect(effective.distanceMeters).toBe(0); expect(effective.pace.secondsPerKm).toBeNull();
  expect(laps.every(lap => lap.kmPerHour === null && lap.projectedTimeSeconds(42195) === null)).toBe(true);
});
test('invalid interval inputs return no laps rather than NaN or Infinity', () => {
  expect(timeLapRanges(Infinity)).toEqual([]); expect(timeLapRanges(10, NaN)).toEqual([]);
  expect(completedLapAnalysis(run(), NaN)).toBeNull(); expect(completedLapAnalysis(run(), 0)).toBeNull();
});
