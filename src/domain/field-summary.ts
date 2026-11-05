import { summarizeStopLatency } from './stop-latency';

type Entry = Parameters<typeof summarizeStopLatency>[0][number] & { audio?: Record<string, unknown> };
const distribution = (values: number[]) => {
  values.sort((a, b) => a - b);
  const q = (p: number) => values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
  return { count: values.length, p50: q(.5), p95: q(.95), max: values.at(-1) ?? null };
};
/** Read-only aggregation of retained journal rows. Missing telemetry is unknown. */
export function summarizeFieldRun(entries: Entry[], runId: string) {
  const rows = entries.filter(e => e.data?.runId === runId);
  const unique = new Map<string, Entry>();
  for (const e of rows) unique.set(JSON.stringify([e.id, e.type, e.status, e.loggedAt]), e);
  const retained = [...unique.values()];
  const ids = (predicate: (e: Entry) => boolean) => new Set(retained.filter(predicate).map(e => e.id).filter(Boolean)).size;
  const count = (type: string, status: string) => retained.filter(e => e.type === type && e.status === status).length;
  const transitions = retained.filter(e => e.type === 'STOP_PIPELINE' && ['STOP_CONFIRMED', 'RESUME_CONFIRMED'].includes(e.status ?? ''))
    .sort((a, b) => (a.loggedAt ?? 0) - (b.loggedAt ?? 0));
  const noise = retained.filter(e => e.type === 'NOISE_LEVEL').sort((a,b) => (a.loggedAt ?? 0) - (b.loggedAt ?? 0));
  const gains = noise.filter(e => e.status === 'MONITORING').map(e => e.data?.gain).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  let observedValidMs = 0;
  for (let i = 1; i < noise.length; i++) {
    const a = noise[i - 1], b = noise[i], delta = (b.loggedAt ?? 0) - (a.loggedAt ?? 0);
    if (a.status === 'MONITORING' && b.status === 'MONITORING' && delta > 0 && delta <= 6000) observedValidMs += delta;
  }
  const measurementSessions = new Map<number, number>();
  for (const e of noise) {
    const snapshot = e.data?.summary as { startedAt?: number; validMeasurementMs?: number } | undefined;
    if (typeof snapshot?.startedAt === 'number' && typeof snapshot.validMeasurementMs === 'number') {
      measurementSessions.set(snapshot.startedAt, Math.max(measurementSessions.get(snapshot.startedAt) ?? 0, snapshot.validMeasurementMs));
    }
  }
  const latency = summarizeStopLatency(retained, runId);
  return { schema: 1, runId, retainedRows: retained.length,
    coverage: { pipeline: retained.some(e => e.type === 'STOP_PIPELINE'), voiceGeneration: retained.some(e => e.type === 'VOICE_GENERATED'), noise: noise.length > 0,
      firstLoggedAt: Math.min(...retained.map(e => e.loggedAt ?? Infinity)), lastLoggedAt: Math.max(...retained.map(e => e.loggedAt ?? -Infinity)) },
    repositoryQueueMs: latency.stages.repositoryQueueMs ? { ...latency.stages.repositoryQueueMs, p50: latency.stages.repositoryQueueMs.median } : null,
    autoStop: { candidates: new Set(latency.candidates.filter(c => c.phase === 'stop' && c.candidateDetectedAt !== null).map(c => c.candidateId)).size,
      confirmed: count('STOP_PIPELINE', 'STOP_CONFIRMED'), resumed: count('STOP_PIPELINE', 'RESUME_CONFIRMED'),
      rapidAlternations: transitions.slice(1).filter((e, i) => e.status !== transitions[i].status && (e.loggedAt ?? 0) - (transitions[i].loggedAt ?? 0) <= 30000).length,
      rapidWindowMs: 30000 },
    voice: { generated: ids(e => e.type === 'VOICE_GENERATED' || e.status === 'GENERATED'), started: ids(e => e.status === 'STARTED'),
      completed: ids(e => e.status === 'DONE'), interrupted: ids(e => /INTERRUPTED|SERVICE_DESTROYED/.test(e.status ?? '')),
      expired: ids(e => /EXPIRED/.test(e.status ?? '')),
      invalidatedOrSkipped: ids(e => /DISCARDED|STALE_STATE|SKIPPED/.test(e.status ?? '')),
      adaptiveUnavailable: ids(e => e.status === 'STARTED' && ['FIVE_MINUTES','KILOMETER_LAP','PACE_WARNING','RUN_GOAL_FINISHED','RUN_STARTED','GOAL_WARNING'].includes(e.type ?? '') && e.audio?.configured === true && e.audio?.fallbackReason === 'MICROPHONE_INACTIVE_OR_STALE'),
      fallback: ids(e => Boolean(e.audio?.adaptiveFallback) || /SYNTHESIS_(FAILED|TIMEOUT|REJECTED)|ADAPTIVE_(PREPARE|START|PLAYER)_FAILED/.test(e.status ?? '')) },
    chime: Object.fromEntries(['CHIME_PREPARING', 'CHIME_STARTED', 'CHIME_COMPLETED', 'CHIME_FAILED', 'CHIME_TIMEOUT'].map(s => [s, ids(e => e.status === s)])),
    noise: { validMeasurementMs: measurementSessions.size ? [...measurementSessions.values()].reduce((a,b) => a+b,0) : null, observedValidMs, gain: distribution(gains), atCeilingSamples: gains.filter(g => g >= .99).length,
      gainBuckets: { quiet: gains.filter(g => g <= .7).length, intermediate: gains.filter(g => g > .7 && g < .99).length, ceiling: gains.filter(g => g >= .99).length },
      sampleCount: gains.length, sampling: 'Retained 5-second monitoring rows; valid time is a conservative observed interval sum.' },
    currentTime: { completed: ids(e => e.type === 'CURRENT_TIME' && e.status === 'DONE'),
      expiredOrSkipped: ids(e => e.type === 'CURRENT_TIME' && /EXPIRED|SKIPPED|DISCARDED|INTERRUPTED/.test(e.status ?? '')) },
    limitations: ['Retained log only; missing telemetry is unknown, not zero. Compare coverage before comparing counts.',
      'Voice counts are distinct event IDs; one event may complete after an interruption/retry.',
      'Gain and DONE callbacks do not measure output loudness or audibility.', 'Rapid alternations are diagnostic only; detector rules are unchanged.'] };
}
