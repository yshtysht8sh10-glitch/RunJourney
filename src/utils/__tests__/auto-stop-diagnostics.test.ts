import { ActiveRun, LocationPoint } from '@/types/run';
import { detectStop, RUN_CONTROL, stateOf } from '@/utils/run-model';
import { diagnosticReport } from '@/utils/auto-stop-diagnostics';
import { legacyDetectStop } from '@/utils/legacy-auto-stop-audit';

const p = (timestamp: number, meters = 0, speed: number | undefined = 0, accuracy = 5): LocationPoint => ({ timestamp, latitude: 35 + meters / 111195, longitude: 139, speed, accuracy });
const base = (): ActiveRun => ({ id: 'diag', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0,
  features: { autoStop: true, break: true }, diagnostics: { entries: [], counts: {}, processed: 0 } });
test('strict legacy 16s-gap loop reproduces non-trigger; corroborated low-speed fixes now confirm', () => {
  let old = base(), next = base();
  for (const time of [0, 16000, 32000]) { old = legacyDetectStop(old, p(time)); next = detectStop(next, p(time)); }
  expect(stateOf(old)).toBe('RUNNING');
  expect(stateOf(next)).toBe('AUTO_STOP');
  expect(next.events?.[0]).toMatchObject({ timestamp: 0, confirmedAt: 16000 });
  expect(next.diagnostics?.counts['STOP_CONFIRMED:GPS_INTERVAL_TOO_LONG']).toBe(1);
});
test('poor accuracy is held, never confirms from an unreliable fix, expires after bounded silence', () => {
  let next = detectStop(base(), p(0));
  next = detectStop(next, p(5000, 200, 4, 100));
  expect(stateOf(next)).toBe('RUNNING'); expect(next.detector?.stillSince).toBe(0);
  expect(next.diagnostics?.entries.at(-1)).toMatchObject({ decision: 'HOLD', reason: 'ACCURACY_POOR' });
  const valid = detectStop(next, p(10000));
  expect(valid.events?.[0].timestamp).toBe(0);
  const expired = detectStop(next, p(60001, 200, 4, 100));
  expect(expired.detector?.stillSince).toBeUndefined();
  expect(expired.diagnostics?.entries.at(-1)?.reason).toBe('CANDIDATE_TIMEOUT');
});
test('missing speed with bounded displacement jitter does not become proof of movement', () => {
  const first = { ...p(0), speed: undefined }, second = { ...p(5000, 4), speed: undefined };
  const next = detectStop(detectStop(base(), first), second);
  expect(stateOf(next)).toBe('AUTO_STOP');
  expect(next.diagnostics?.entries.at(-1)).toMatchObject({ effectiveSpeed: expect.any(Number), candidateAgeMs: 5000, decision: 'STOP_CONFIRMED' });
});
test('small reported-speed jitter is corroborated by stable accurate positions', () => {
  let next = detectStop(base(), p(0, 0, 0.8));
  next = detectStop(next, p(5000, 1, 0.8));
  next = detectStop(next, p(10000, 2, 0.8));
  expect(stateOf(next)).toBe('AUTO_STOP');
  expect(next.events?.[0].timestamp).toBe(5000);
});
test('bouncing in place can confirm stable horizontal position despite elevated reported speed', () => {
  let next = detectStop(base(), p(0, 0, 2));
  next = detectStop(next, p(5000, 1, 2));
  next = detectStop(next, p(10000, 0, 2));
  expect(stateOf(next)).toBe('AUTO_STOP'); expect(next.events?.[0].timestamp).toBe(5000);
});
test('clear motion or displacement resets instead of confirming; null speed after gap cannot confirm', () => {
  const pending = detectStop(base(), p(0));
  expect(detectStop(pending, p(2000, 5, 3)).detector?.stillSince).toBeUndefined();
  expect(detectStop(pending, p(5000, 10)).events).toBeUndefined();
  const unknown = detectStop(pending, { ...p(16000), speed: undefined });
  expect(stateOf(unknown)).toBe('RUNNING'); expect(unknown.diagnostics?.entries.at(-1)?.decision).toBe('HOLD');
});
test('OFF disables detector and diagnostics say why; BREAK remains manual', () => {
  const off = detectStop({ ...base(), features: { autoStop: false, break: false } }, p(5000));
  expect(off.detector).toBeUndefined(); expect(off.diagnostics?.entries.at(-1)?.reason).toBe('SETTING_DISABLED');
  const paused = detectStop({ ...base(), events: [{ timestamp: 0, state: 'BREAK', source: 'user' }] }, p(5000, 100, 3));
  expect(stateOf(paused)).toBe('BREAK'); expect(paused.diagnostics?.entries.at(-1)?.reason).toBe('STATE_CHANGED');
});
test('logs bound retained entries, preserve whole-run counters and survive serialization', () => {
  let next = base();
  for (let index = 0; index < RUN_CONTROL.diagnosticEntries + 10; index++) next = detectStop(next, p(index * 1000, index * 3, 3));
  const restored: ActiveRun = JSON.parse(JSON.stringify(next));
  expect(restored.diagnostics?.entries).toHaveLength(RUN_CONTROL.diagnosticEntries);
  expect(restored.diagnostics?.processed).toBe(RUN_CONTROL.diagnosticEntries + 10);
});
test('historical audit preserves input and omits coordinates, labels replay separately from actual', () => {
  const run = { ...base(), points: [p(0), p(16000), p(32000)], diagnostics: undefined };
  const original = JSON.stringify(run), report = diagnosticReport(run, 'hash');
  expect(JSON.stringify(run)).toBe(original);
  expect(report.legacyV4Replay.events ?? []).toHaveLength(0);
  expect(report.currentReplay.events).toHaveLength(1);
  expect(report.quality.intervalsOver15s).toBe(2);
  expect(report.actualDiagnostics).toBeNull();
  expect(JSON.stringify(report)).not.toMatch(/latitude|longitude/);
});
