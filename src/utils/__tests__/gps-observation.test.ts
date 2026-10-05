import AsyncStorage from '@react-native-async-storage/async-storage';
import { RollingObservationBuffer, GpsPersistenceGate, RawLocationObservation, GpsObservationSession, observationDiagnosticSummary } from '@/utils/gps-observation';
import { RunRepository } from '@/repositories/run-repository';
import { ActiveRun } from '@/types/run';
import { effectiveRun } from '@/utils/run-model';
import { diagnosticReport } from '@/utils/auto-stop-diagnostics';
import { parseBackup, serializeBackup } from '@/utils/run-backup';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const raw = (timestamp: number, speed: number | null = 2, accuracy: number | null = 5): RawLocationObservation => ({ timestamp, receivedAt: timestamp + 10,
  latitude: 35 + timestamp / 500 / 111195, longitude: 139, speed, accuracy });
const base = (): ActiveRun => ({ id: 'observations', startedAt: new Date(0).toISOString(), points: [], distanceMeters: 0, createdAt: '', updatedAt: '',
  features: { autoStop: false, break: true }, events: [], diagnostics: { entries: [], counts: {}, processed: 0 } });
beforeEach(async () => { await RunRepository.clearActiveRun(); await AsyncStorage.clear(); jest.clearAllMocks(); });
afterEach(async () => { jest.restoreAllMocks(); await RunRepository.clearActiveRun(); });

test('empty, timestamp order, duplicate, exact window boundary, irregular fixes, poor accuracy and null speed', () => {
  const buffer = new RollingObservationBuffer();
  expect(buffer.getLatest()).toBeNull(); expect(buffer.getRecent()).toEqual([]);
  for (const time of [10000, 0, 800, 2000, 1200]) buffer.add(raw(time, null, 100));
  expect(buffer.getRecent().map(p => p.timestamp)).toEqual([0, 800, 1200, 2000, 10000]);
  expect(buffer.add(raw(2000))).toBe(false);
  expect(buffer.getLatest()?.speed).toBeNull(); expect(buffer.getLatest()?.accuracy).toBe(100);
  buffer.add(raw(10001)); expect(buffer.getRecent().map(p => p.timestamp)).not.toContain(0);
  expect(buffer.getRecent(1000).map(p => p.timestamp)).toEqual([10000, 10001]);
  const copy = buffer.getLatest()!; copy.latitude = 0; expect(buffer.getLatest()!.latitude).not.toBe(0);
  buffer.add(raw(30000)); expect(buffer.getRecent()).toHaveLength(1);
  expect(buffer.add(raw(10000))).toBe(false);
  expect(buffer.add(raw(NaN))).toBe(false);
  expect(buffer.getRecent(10000, 50000)).toEqual([]);
  buffer.clear(); expect(buffer.getLatest()).toBeNull(); expect(buffer.add(raw(0))).toBe(true);
});
test('buffer has a hard RAM bound during bursts', () => {
  const buffer = new RollingObservationBuffer();
  for (let t = 0; t < 1000; t++) buffer.add(raw(t));
  expect(buffer.getRecent()).toHaveLength(256);
});
test('gate saves first fix, ~5s at 1s input, gaps, irregular callbacks, duplicate and stop tail', () => {
  const gate = new GpsPersistenceGate(undefined);
  expect(Array.from({ length: 12 }, (_, i) => i * 1000).filter(t => gate.accept(t))).toEqual([0, 5000, 10000]);
  expect(gate.accept(10000, true)).toBe(false);
  expect(gate.accept(11000, true)).toBe(true);
  expect(gate.accept(16000)).toBe(true);
  expect(gate.accept(17000)).toBe(false); expect(gate.accept(21400)).toBe(true);
  expect(new GpsPersistenceGate(21400).accept(21400)).toBe(false);
});
test('whole-run interval distributions, batch/gap/accuracy/speed metadata, without coordinates', () => {
  const session = new GpsObservationSession(undefined, undefined), counts = {};
  session.ingest([raw(0), raw(800, null, 100)], counts, 'active', 0);
  session.ingest([raw(2000)], counts, 'background', 0);
  session.ingest([raw(9000)], counts, 'background', 0);
  const report = observationDiagnosticSummary(counts, 2)!;
  expect(report.observationCount).toBe(4); expect(report.persistedGpsCount).toBe(2);
  expect(report.intervalsMs).toMatchObject({ min: 800, max: 7000, average: 3000, median: '1200–1299ms', p95: '7000–7099ms' });
  expect(report.speedAvailableCount).toBe(3); expect(report.accuracyPoorOrMissing).toBe(1);
  expect(report.batchCallbacks).toBe(1); expect(report.callbackGapsOver5s).toBe(1);
  expect(JSON.stringify(report)).not.toMatch(/latitude|longitude/);
});
test('1s observations persist 5s edges; total, laps and speed match the previous 5s input path', async () => {
  await RunRepository.saveActiveRun(base());
  const writes = jest.spyOn(AsyncStorage, 'setItem');
  writes.mockClear();
  for (let time = 0; time <= 30000; time += 1000) await RunRepository.appendActiveObservations([raw(time)], 'active');
  expect(writes.mock.calls.filter(([key]) => key === '@runjourney/active-run/v1')).toHaveLength(7);
  expect((await RunRepository.getRecentObservations(10000, 30000)).map(p => p.timestamp)).toEqual(Array.from({ length: 11 }, (_, i) => 20000 + i * 1000));
  const high = (await RunRepository.finishActiveRun(new Date(30000).toISOString()))!;
  expect(high.points.map(p => p.timestamp)).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000]);
  expect(high.diagnostics!.counts.GPS_OBS_COUNT).toBe(31);
  await RunRepository.saveActiveRun({ ...base(), id: 'baseline' });
  await RunRepository.appendActivePoints(high.points);
  const low = (await RunRepository.finishActiveRun(high.endedAt))!;
  expect(high.distanceMeters).toBe(low.distanceMeters);
  expect(effectiveRun(high).pace.kmPerHour).toBe(effectiveRun(low).pace.kmPerHour);
  const metrics = (run: ActiveRun) => effectiveRun(run).laps().map(({ projectedTimeSeconds: _projected, ...lap }) => lap);
  expect(metrics(high)).toEqual(metrics(low));
  expect(parseBackup(serializeBackup([high], {}, 1)).runs[0]).toEqual(high);
  expect(JSON.stringify(diagnosticReport(high, 'hash'))).not.toMatch(/latitude|longitude/);
});
test('stop flushes the trailing RAM fix, clears buffer, and late callbacks cannot create a run', async () => {
  await RunRepository.saveActiveRun(base());
  await RunRepository.appendActiveObservations([raw(0), raw(1000), raw(2000)]);
  const saved = (await RunRepository.finishActiveRun(new Date(2500).toISOString()))!;
  expect(saved.points.map(p => p.timestamp)).toEqual([0, 2000]);
  expect(saved.diagnostics!.counts.GPS_OBS_COUNT).toBe(3);
  expect(await RunRepository.getRecentObservations()).toEqual([]);
  expect(await RunRepository.appendActiveObservations([raw(3000)])).toBeNull();
});
test('restart restores gate and aggregates but resets RAM; drops duplicate/stale/pre-start samples', async () => {
  await RunRepository.saveActiveRun(base());
  await RunRepository.appendActiveObservations([raw(0), raw(5000)]);
  const checkpoint = (await RunRepository.getActiveRun())!;
  await RunRepository.saveActiveRun(JSON.parse(JSON.stringify(checkpoint)));
  await RunRepository.appendActiveObservations([raw(5000), raw(4000), raw(6000)]);
  const active = (await RunRepository.getActiveRun())!;
  expect(active.points.map(p => p.timestamp)).toEqual([0, 5000]);
  expect(active.diagnostics!.counts.GPS_OBS_COUNT).toBe(3);
  expect(active.diagnostics!.counts.GPS_OBS_SEGMENTS).toBe(2);
  expect(active.diagnostics!.counts.GPS_OBS_STALE_OR_INVALID).toBe(2);
  await RunRepository.saveActiveRun({ ...base(), startedAt: new Date(5000).toISOString() });
  await RunRepository.appendActiveObservations([raw(0), raw(5000)]);
  expect((await RunRepository.getActiveRun())!.points.map(p => p.timestamp)).toEqual([5000]);
});
test('shared Auto Stop confirms after 5s, raw onset survives; manual Break cannot auto resume', async () => {
  await RunRepository.saveActiveRun({ ...base(), features: { autoStop: true, break: true } });
  const stationary = (t: number) => ({ ...raw(t, 0), latitude: 35 });
  for (let t = 0; t <= 5000; t += 1000) await RunRepository.appendActiveObservations([stationary(t)]);
  const stopped = (await RunRepository.getActiveRun())!;
  expect(stopped.events).toEqual([expect.objectContaining({ state: 'AUTO_STOP', timestamp: 0, confirmedAt: 5000 })]);
  expect(stopped.points).toHaveLength(2); expect(stopped.diagnostics!.processed).toBe(6);
  await RunRepository.transition('BREAK', 6000);
  await RunRepository.appendActiveObservations([raw(7000)]);
  expect((await RunRepository.getActiveRun())!.events?.at(-1)?.state).toBe('BREAK');
  await RunRepository.transition('RUNNING', 8000);
  expect((await RunRepository.getActiveRun())!.events?.at(-1)?.state).toBe('RUNNING');
});
test('failed checkpoint retries without losing selected points', async () => {
  await RunRepository.saveActiveRun(base());
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(RunRepository.appendActiveObservations([raw(0)])).rejects.toThrow('disk full');
  await RunRepository.appendActiveObservations([raw(1000)]);
  const stored = JSON.parse((await AsyncStorage.getItem('@runjourney/active-run/v1'))!);
  expect(stored.points.map((p: { timestamp: number }) => p.timestamp)).toEqual([0]);
  expect(stored.diagnostics.counts.GPS_OBS_COUNT).toBe(2);
});

test('30 minute 1s stream remains approximately 360 persisted points with bounded counters and RAM', () => {
  const session = new GpsObservationSession(undefined, undefined), counts: Record<string, number> = {};
  let persisted = 0;
  for (let t = 0; t < 1800000; t += 1000) persisted += session.ingest([raw(t)], counts, 'active', 0).filter(p => p.persist).length;
  expect(persisted).toBe(360);
  expect(counts.GPS_OBS_COUNT).toBe(1800);
  expect(session.buffer.getRecent()).toHaveLength(11);
  expect(Object.keys(counts).length).toBeLessThan(100);
});

test('failed STOP save retains its flushed tail for a successful retry without duplicates', async () => {
  await RunRepository.saveActiveRun(base());
  await RunRepository.appendActiveObservations([raw(0), raw(1000), raw(2000)]);
  jest.spyOn(AsyncStorage, 'multiSet').mockRejectedValueOnce(new Error('disk full'));
  await expect(RunRepository.finishActiveRun(new Date(2500).toISOString())).rejects.toThrow('disk full');
  const saved = (await RunRepository.finishActiveRun(new Date(2500).toISOString()))!;
  expect(saved.points.map(p => p.timestamp)).toEqual([0, 2000]);
  expect((await RunRepository.getRuns()).filter(r => r.id === saved.id)).toHaveLength(1);
});
