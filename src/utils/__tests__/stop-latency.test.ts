import { StopLatencyTracker, summarizeStopLatency } from '@/domain/stop-latency';
import { StopDiagnostic } from '@/types/run';
import { inferMovement, MOVEMENT_THRESHOLDS, movementGates } from '@/utils/movement-inference';
const timing = (sample: number, delay = 100) => ({ callbackAt: sample + delay, submittedAt: sample + delay + 10, enteredAt: sample + delay + 60, evaluatedAt: sample + delay + 61, finishedAt: sample + delay + 63 });
const entry = (timestamp: number, decision: StopDiagnostic['decision'] = 'CONTINUE'): StopDiagnostic => ({ timestamp, decision, state: 'RUNNING', candidateStartedAt: 1000, speed: 0, accuracy: 5 });

test('one candidate links observed sample, JS callback, queue, evaluation and confirmation without changing input', () => {
  const tracker = new StopLatencyTracker(), original = entry(1000);
  const a = tracker.annotate('r', original, timing(1000));
  const b = tracker.annotate('r', { ...entry(6000, 'STOP_CONFIRMED'), state: 'AUTO_STOP' }, timing(6000, 500));
  expect(a.pipeline?.candidateId).toBe(b.pipeline?.candidateId);
  expect(a.pipeline).toMatchObject({ deliveryLagMs: 100, repositoryWaitMs: 50, evaluationMs: 2, lowSpeedObservedAt: 1000, candidateDetectedAt: 1163 });
  expect(original.pipeline).toBeUndefined();
  expect(b.timestamp).toBe(6000);
  const summary = summarizeStopLatency([a, b].map(d => ({ id: `${d.timestamp}`, type: 'STOP_PIPELINE', status: d.decision, data: { runId: 'r', pipeline: d.pipeline } })));
  expect(summary.stages.candidateToConfirmationMs.max).toBe(5400);
  expect(summary.candidates).toHaveLength(1);
});
test('cancellation and process restarts never reuse a candidate ID', () => {
  const tracker = new StopLatencyTracker();
  const a = tracker.annotate('r', entry(1000), timing(1000));
  tracker.annotate('r', entry(2000, 'RESET'), timing(2000));
  const b = tracker.annotate('r', entry(3000), timing(3000));
  const c = new StopLatencyTracker().annotate('r', entry(4000), timing(4000));
  expect(new Set([a.pipeline?.candidateId, b.pipeline?.candidateId, c.pipeline?.candidateId]).size).toBe(3);
});
test('clock skew and missing telemetry remain unknown, not zero delays', () => {
  const d = new StopLatencyTracker().annotate('r', entry(1000), { ...timing(1000), callbackAt: 900 });
  expect(d.pipeline?.deliveryLagMs).toBeNull(); expect(d.pipeline?.clockOrderValid).toBe(false);
  expect(summarizeStopLatency([{ type: 'AUTO_STOP_CONFIRMED', status: 'EXPIRED' }]).stages).toEqual({});
});
test('summary separates playback categories, journal duplicates and run IDs', () => {
  const row = { id: 'a', type: 'AUTO_STOP_CONFIRMED', status: 'STARTED', startedAt: 1300, nativeQueuedAt: 1000, loggedAt: 1300, data: { runId: 'r' } };
  const result = summarizeStopLatency([row, row, { ...row, id: 'b', data: { runId: 'other' } }], 'r');
  expect(result.stages.nativeQueueToTtsStartMs.count).toBe(1);
  expect(result.stages['AUTO_STOP_CONFIRMED:nativeQueueToTtsStartMs'].median).toBe(300);
});
test('diagnostic thresholds describe the unchanged 5s narrow and 8s bounded conditions', () => {
  const points = [0, 1000, 2000, 3000, 4000, 5000].map(timestamp => ({ timestamp, latitude: 35, longitude: 139, accuracy: 5, speed: 0 }));
  expect(inferMovement(points.slice(0, -1)).stationary).toBe(false);
  const inference = inferMovement(points);
  expect(inference.stationary).toBe(true); expect(movementGates(inference.summary).coverage).toBe(true);
  expect(MOVEMENT_THRESHOLDS).toMatchObject({ coverageMs: 5000, dwellMs: 8000, narrowSpread: 3, dwellSpread: 8 });
});
