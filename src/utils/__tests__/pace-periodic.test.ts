import { pacePeriodicSnapshots, paceSchedule, PACE_PERIODIC_MAX_BATCH } from '@/domain/pace-periodic';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS, PaceStatus } from '@/domain/pace-workout';
import { ActiveRun } from '@/types/run';

const start = 1000000;
function run(minutes = 4): ActiveRun {
  return { id: 'periodic', startedAt: new Date(start).toISOString(), createdAt: '', updatedAt: '',
    distanceMeters: 99999, features: { autoStop: false, break: true }, events: [],
    paceWorkout: createPaceWorkout({ ...DEFAULT_PACE_SETTINGS, enabled: true, voice: true, voiceIntervalSec: 60, paceSecPerKm: 360 }, start),
    points: Array.from({ length: minutes * 12 + 1 }, (_, i) => ({ latitude: 35 + i * 15 / 111195, longitude: 139, timestamp: start + i * 5000, accuracy: 5, speed: 3 })) };
}
const cursor = { acceptedThrough: 0, activeFromMs: start };

test.each<PaceStatus>(['FAST', 'SLOW', 'ON_TARGET', 'UNKNOWN'])('every fixed interval exists for classification %s', status => {
  const r = run(); r.paceWorkout!.status = status;
  const snapshots = pacePeriodicSnapshots(r, start + 180000, cursor);
  expect(snapshots.map(s => s.endAt)).toEqual([60000, 120000, 180000].map(t => start + t));
  expect(snapshots.every(s => s.quality === 'READY')).toBe(true);
  expect(snapshots[0].message).toContain('この1分で');
  expect(snapshots[0].distanceMeters).toBeCloseTo(180, 1);
  expect(snapshots[0].savingsSec).toBeCloseTo(4.8, 1);
});

test('late playback cannot change boundaries, distance, delta or the next schedule', () => {
  const r = run(), before = JSON.stringify(r);
  const immediate = pacePeriodicSnapshots(r, start + 60000, cursor)[0];
  const late = pacePeriodicSnapshots(r, start + 210000, cursor)[0];
  expect(late).toEqual(immediate);
  expect(pacePeriodicSnapshots(r, start + 210000, { ...cursor, acceptedThrough: 1 })[0].startAt).toBe(start + 60000);
  expect(JSON.stringify(r)).toBe(before);
  expect(immediate.distanceMeters).not.toBe(r.distanceMeters);
});

test('120/180 second periods remain anchored to RUN start and first interval has a zero baseline', () => {
  for (const seconds of [120, 180]) {
    const r = run(8); r.paceWorkout!.voiceIntervalSec = seconds;
    const result = pacePeriodicSnapshots(r, start + 480000, cursor);
    expect(result.map(s => s.endAt - start)).toEqual(Array.from({ length: Math.floor(480 / seconds) }, (_, i) => (i + 1) * seconds * 1000));
    expect(result[0].startSavingsSec).toBe(0);
    expect(result[0].message).toContain(`この${seconds / 60}分で`);
  }
});

test('stopped intervals keep wall slots; no-active slot cancels explicitly and mixed slots use active time', () => {
  const r = run();
  r.events = [{ state: 'BREAK', source: 'user', timestamp: start + 30000 }, { state: 'RUNNING', source: 'user', timestamp: start + 150000 }];
  const result = pacePeriodicSnapshots(r, start + 180000, cursor);
  expect(result.map(s => s.activeMs)).toEqual([30000, 0, 30000]);
  expect(result[1]).toMatchObject({ slot: 2, quality: 'CANCELLED_NO_RUNNING', message: '' });
  expect(result[2].startAt).toBe(start + 120000);
});

test('pending auto-stop and detector settling keep boundary unacknowledged', () => {
  const r = run(); r.features!.autoStop = true;
  expect(pacePeriodicSnapshots(r, start + 60000, cursor)).toEqual([]);
  expect(pacePeriodicSnapshots(r, start + 75000, cursor)).toHaveLength(1);
  r.detector = { stillSince: start + 59000 };
  expect(pacePeriodicSnapshots(r, start + 90000, cursor)).toEqual([]);
  r.detector = {};
  expect(pacePeriodicSnapshots(r, start + 90000, cursor)).toHaveLength(1);
});

test.each(['gap', 'accuracy', 'missing-end', 'reverse', 'spike'] as const)('GPS %s emits explicit insufficient data without fabricated numbers', condition => {
  const r = run();
  if (condition === 'gap') r.points = r.points.filter(p => p.timestamp < start + 20000 || p.timestamp > start + 40000);
  if (condition === 'accuracy') r.points[5].accuracy = 100;
  if (condition === 'missing-end') r.points = r.points.filter(p => p.timestamp < start + 60000);
  if (condition === 'reverse') r.points[5].timestamp = r.points[4].timestamp;
  if (condition === 'spike') r.points[5].latitude += 1;
  const snapshot = pacePeriodicSnapshots(r, start + 75000, cursor)[0];
  expect(snapshot.quality).toBe('DATA_INSUFFICIENT');
  expect(snapshot.message).toContain('データが不足');
  expect(snapshot.distanceMeters).toBeUndefined();
  expect(snapshot.savingsSec).toBeUndefined();
});

test('a just-due interval waits for a delayed bracketing fix instead of permanently reporting missing data', () => {
  const r = run(); r.points = r.points.filter(p => p.timestamp < start + 60000);
  expect(pacePeriodicSnapshots(r, start + 60000, cursor)).toEqual([]);
  r.points.push({ ...r.points.at(-1)!, timestamp: start + 62000, latitude: 35 + 186 / 111195 });
  expect(pacePeriodicSnapshots(r, start + 62000, cursor)[0].quality).toBe('READY');
});

test('boundary interpolation uses bracketing fixes, never latest totals', () => {
  const r = run(); r.points = r.points.map(p => ({ ...p, timestamp: p.timestamp + 2000 }));
  const first = pacePeriodicSnapshots(r, start + 60000, cursor)[0];
  expect(first.quality).toBe('READY');
  expect(first.distanceMeters).toBeCloseTo(174, 1);
});

test('bad future observations cannot contaminate an earlier interval snapshot', () => {
  const r = run();
  const first = pacePeriodicSnapshots(r, start + 60000, cursor)[0];
  r.points[20].accuracy = 100;
  r.points[21].timestamp = r.points[20].timestamp;
  expect(pacePeriodicSnapshots(r, start + 120000, cursor)[0]).toEqual(first);
});

test('OFF/end/invalid cursors create no speech; mid-interval configuration does not recompute old intervals', () => {
  const r = run();
  expect(pacePeriodicSnapshots(r, start + 120000, { ...cursor, acceptedThrough: NaN })).toEqual([]);
  const changed = pacePeriodicSnapshots(r, start + 180000, { ...cursor, activeFromMs: start + 90000 });
  expect(changed.map(s => s.quality)).toEqual(['CONFIG_CHANGED', 'CONFIG_CHANGED', 'READY']);
  const key = paceSchedule(r)!.configKey;
  r.paceWorkout!.voiceIntervalSec = 120; expect(paceSchedule(r)!.configKey).not.toBe(key);
  r.paceWorkout!.voice = false; expect(pacePeriodicSnapshots(r, start + 120000, cursor)).toEqual([]);
  r.paceWorkout!.voice = true; r.endedAt = new Date(start + 120000).toISOString();
  expect(pacePeriodicSnapshots(r, start + 180000, cursor)).toEqual([]);
});

test('catch-up memory is bounded and unaccepted remainder is available on the next ACK cursor', () => {
  const r = run(60);
  const first = pacePeriodicSnapshots(r, start + 3600000, cursor);
  expect(first).toHaveLength(PACE_PERIODIC_MAX_BATCH);
  const next = pacePeriodicSnapshots(r, start + 3600000, { ...cursor, acceptedThrough: first.at(-1)!.slot });
  expect(next[0].slot).toBe(PACE_PERIODIC_MAX_BATCH + 1);
  expect(next.at(-1)!.slot).toBe(60);
});
