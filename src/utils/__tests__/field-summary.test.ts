import { summarizeFieldRun } from '@/domain/field-summary';

test('separates runs, deduplicates callbacks and counts fallback once per event', () => {
  const row = (id: string, type: string, status: string, loggedAt: number, extra = {}) => ({ id, type, status, loggedAt, data: { runId: 'r' }, ...extra });
  const started = row('a', 'FIVE_MINUTES', 'STARTED', 10, { audio: { adaptiveFallback: 'SYNTHESIS_TIMEOUT' } });
  const summary = summarizeFieldRun([row('a', 'VOICE_GENERATED', 'FIVE_MINUTES', 1), started, started,
    row('a', 'FIVE_MINUTES', 'DONE', 20, { audio: { adaptiveFallback: 'SYNTHESIS_TIMEOUT' } }),
    row('b', 'CURRENT_TIME', 'SKIPPED_CLOCK_BUSY_PAUSED_OR_LATE', 30),
    row('other', 'CURRENT_TIME', 'DONE', 40, { data: { runId: 'other' } })], 'r');
  expect(summary.voice).toMatchObject({ generated: 1, started: 1, completed: 1, fallback: 1 });
  expect(summary.currentTime).toEqual({ completed: 0, expiredOrSkipped: 1 });
  expect(summary.repositoryQueueMs).toBeNull();
  expect(summary.noise.gain.p50).toBeNull();
});
test('noise duration excludes gaps, calibration and feedback holds; gain quantiles use valid samples', () => {
  const rows = [0, 5000, 10000, 25000].map((loggedAt, i) => ({ type: 'NOISE_LEVEL', status: 'MONITORING', loggedAt,
    data: { runId: 'r', gain: [.65, .8, 1, .9][i] } }));
  const summary = summarizeFieldRun(rows, 'r');
  expect(summary.noise.observedValidMs).toBe(10000);
  expect(summary.noise.gain).toEqual({ count: 4, p50: .8, p95: 1, max: 1 });
  expect(summary.noise.atCeilingSamples).toBe(1);
});
test('rapid alternation is descriptive and uses distinct transitions only', () => {
  const rows = [1000, 6000, 50000].map((loggedAt, i) => ({ id: String(i), type: 'STOP_PIPELINE', loggedAt,
    status: i === 1 ? 'RESUME_CONFIRMED' : 'STOP_CONFIRMED', data: { runId: 'r' } }));
  expect(summarizeFieldRun(rows, 'r').autoStop).toMatchObject({ confirmed: 2, resumed: 1, rapidAlternations: 1 });
});
