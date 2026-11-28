/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { CyclingRecorder } from '@/repositories/cycling-recorder';
import { DEFAULT_CYCLING_SETTINGS, validateCyclingSettings } from '@/repositories/cycling-settings';
import { SqliteStore, type SqlConnection } from '@/repositories/sqlite-store';
import { CYCLING_PROFILE } from '@/domain/measurement-profile';
import { timeModel } from '@/utils/run-model';
import type { RawLocationObservation } from '@/utils/gps-observation';

const origin = Date.parse('2026-11-28T00:00:00Z');
const raw = (second: number, meters: number, accuracy: number | null = 5): RawLocationObservation => ({
  timestamp: origin + second * 1000, receivedAt: origin + second * 1000 + 100,
  latitude: 35 + meters / 111195, longitude: 139, accuracy, speed: 20,
});
let native: DatabaseSync, store: SqliteStore, recorder: CyclingRecorder, fail = false;
beforeEach(() => {
  native = new DatabaseSync(':memory:');
  const connection: SqlConnection = {
    execAsync: async sql => { native.exec(sql); },
    runAsync: async (sql, ...params) => { if (fail && sql.startsWith('INSERT INTO gps_points')) throw Error('write failed'); return native.prepare(sql).run(...params); },
    getAllAsync: async <T,>(sql: string, ...params: (string | number | null)[]) => native.prepare(sql).all(...params) as T[],
  };
  fail = false; store = new SqliteStore(connection, CYCLING_PROFILE.distance); recorder = new CyclingRecorder(async () => store);
});
afterEach(() => { native.close(); });

test('95-minute Cycling input retains high-speed distance, restores and completes its synthetic DB', async () => {
  await recorder.create('synthetic-95min', new Date(origin).toISOString(), DEFAULT_CYCLING_SETTINGS);
  for (let second = 0; second <= 5700; second += 5) {
    await recorder.ingest(Array.from({ length: second ? 5 : 1 }, (_, i) => {
      const at = second ? second - 4 + i : 0; return raw(at, at * 15);
    }), 'background');
    if (second === 2850) recorder = new CyclingRecorder(async () => store);
  }
  const active = (await recorder.getActive())!;
  expect(active.distanceMeters).toBeCloseTo(85500, -1);
  expect(active.points).toHaveLength(1141);
  await recorder.prepareFinish(new Date(origin + 5700000).toISOString());
  const saved = (await recorder.finish())!;
  expect(saved.distanceMeters).toBeCloseTo(active.distanceMeters, 3);
  expect(timeModel(saved).activeRunningTime).toBe(5700000);
  expect((await store.getRun(saved.id))?.points).toHaveLength(1141);
}, 120000);

test('Cycling defaults are independent and malformed settings do not silently reset', () => {
  expect(DEFAULT_CYCLING_SETTINGS).toEqual({ version: 1, autoStop: false, voice: true, map: false });
  expect(() => validateCyclingSettings({ ...DEFAULT_CYCLING_SETTINGS, version: 2 } as never)).toThrow();
});

test('1Hz input preserves >45km/h travel, throttles raw persistence and flushes last fix before save', async () => {
  await recorder.create('synthetic-cycle', new Date(origin).toISOString(), DEFAULT_CYCLING_SETTINGS);
  for (let second = 0; second <= 13; second++) await recorder.ingest([raw(second, second * 20)]);
  const active = (await recorder.getActive())!;
  expect(active.points.map(p => (p.timestamp - origin) / 1000)).toEqual([0, 5, 10]);
  expect(active.distanceMeters).toBeCloseTo(200, 0);
  await recorder.prepareFinish(new Date(origin + 14000).toISOString());
  const saved = (await recorder.finish())!;
  expect(saved.points.map(p => (p.timestamp - origin) / 1000)).toEqual([0, 5, 10, 13]);
  expect(saved.distanceMeters).toBeCloseTo(260, 0);
  expect((await store.summaries())[0].effective_distance).toBeCloseTo(260, 0);
  expect(await recorder.getActive()).toBeNull();
});

test('failed checkpoint retains RAM cumulative snapshot and retries without duplicate points', async () => {
  await recorder.create('failure', new Date(origin).toISOString(), DEFAULT_CYCLING_SETTINGS);
  await recorder.ingest([raw(0, 0)]); fail = true;
  await expect(recorder.ingest([raw(5, 100)])).rejects.toThrow('write failed');
  expect((await recorder.getActive())?.points.length).toBe(2);
  expect((await store.getDraft())?.points.length).toBe(1);
  fail = false; await recorder.ingest([raw(5, 100), raw(6, 120)]);
  expect((await store.getDraft())?.points.length).toBe(2);
  await recorder.prepareFinish(new Date(origin + 7000).toISOString()); await recorder.finish();
  expect((await store.getRun('failure'))?.points.map(p => p.timestamp)).toEqual([origin, origin + 5000, origin + 6000]);
});

test('recreated recorder restores fixed per-session settings instead of new defaults', async () => {
  await recorder.create('restore', new Date(origin).toISOString(), { ...DEFAULT_CYCLING_SETTINGS, voice: false });
  await recorder.ingest([raw(0, 0), raw(5, 100)]);
  const reopened = new CyclingRecorder(async () => store);
  expect((await reopened.getActive())?.cyclingSettings.voice).toBe(false);
  await reopened.ingest([raw(5, 100), raw(10, 200)]);
  await reopened.prepareFinish(new Date(origin + 11000).toISOString());
  expect((await reopened.finish())?.distanceMeters).toBeCloseTo(200, 0);
});

test('manual pause uses existing active time model and does not add stopped edges', async () => {
  await recorder.create('pause', new Date(origin).toISOString(), DEFAULT_CYCLING_SETTINGS);
  await recorder.ingest([raw(0, 0), raw(5, 25)]);
  await recorder.pause(true, origin + 6000);
  await recorder.ingest([raw(10, 25), raw(15, 25)]);
  await recorder.pause(false, origin + 16000);
  await recorder.ingest([raw(20, 50), raw(25, 75)]);
  const frozen = (await recorder.prepareFinish(new Date(origin + 26000).toISOString()))!;
  expect(timeModel(frozen).activeRunningTime).toBe(16000);
  // Existing manual-resume boundary filtering is conservative: the crossing
  // saved fix cannot anchor the next edge. Do not silently change Running's model.
  expect(frozen.distanceMeters).toBeCloseTo(25, 0);
});

test('Auto Stop is opt-in; same detector can resume at Cycling speed without Running cap', async () => {
  await recorder.create('auto', new Date(origin).toISOString(), { ...DEFAULT_CYCLING_SETTINGS, autoStop: true });
  for (let second = 0; second <= 10; second++) await recorder.ingest([raw(second, 0)]);
  expect(recorder.currentState).toBe('AUTO_STOP');
  for (let second = 11; second <= 20; second++) await recorder.ingest([raw(second, (second - 10) * 20)]);
  expect(recorder.currentState).toBe('RUNNING');
  expect((await recorder.getActive())?.diagnostics?.counts.STOP_CONFIRMED).toBe(1);
  expect((await recorder.getActive())?.diagnostics?.counts.RESUME_CONFIRMED).toBe(1);
});
test('failed prepareFinish must keep failing until its original end and tail are durably ACKed', async () => {
  await recorder.create('end-retry', new Date(origin).toISOString(), DEFAULT_CYCLING_SETTINGS);
  for (let second = 0; second <= 13; second++) await recorder.ingest([raw(second, second * 20)]);
  fail = true;
  await expect(recorder.prepareFinish(new Date(origin + 14000).toISOString())).rejects.toThrow();
  await expect(recorder.prepareFinish(new Date(origin + 30000).toISOString())).rejects.toThrow();
  expect((await store.getDraft())?.endedAt).toBeUndefined();
  fail = false; await recorder.prepareFinish(new Date(origin + 50000).toISOString());
  const stored = (await store.getDraft())!;
  expect(stored.endedAt).toBe(new Date(origin + 14000).toISOString());
  expect(stored.points.at(-1)?.timestamp).toBe(origin + 13000);
});
test('pause flushes received pre-pause raw tail and retains it across save failure and retry', async () => {
  await recorder.create('pause-tail', new Date(origin).toISOString(), DEFAULT_CYCLING_SETTINGS);
  for (let second = 0; second <= 9; second++) await recorder.ingest([raw(second, second * 20)]);
  fail = true; await expect(recorder.pause(true, origin + 10000)).rejects.toThrow();
  expect((await recorder.getActive())?.points.at(-1)?.timestamp).toBe(origin + 9000);
  fail = false; await recorder.pause(true, origin + 10000);
  await recorder.ingest([raw(10, 180), raw(15, 180)]);
  await recorder.prepareFinish(new Date(origin + 16000).toISOString()); const saved = (await recorder.finish())!;
  expect(saved.points.filter(p => p.timestamp === origin + 9000)).toHaveLength(1);
  expect(saved.distanceMeters).toBeCloseTo(180, 0);
});
