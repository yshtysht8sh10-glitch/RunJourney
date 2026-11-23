import type { StopDiagnostic } from '../types/run';
import { MOVEMENT_THRESHOLDS, movementGates } from '../utils/movement-inference';

export type StopPipelineData = {
  candidateId: string | null; phase: 'stop' | 'resume'; sampleAt: number; callbackAt: number;
  submittedAt: number; enteredAt: number; evaluatedAt: number; finishedAt: number;
  deliveryLagMs: number | null; repositoryWaitMs: number | null; evaluationMs: number | null;
  lowSpeedObservedAt: number | null; candidateObservedAt: number | null; candidateDetectedAt: number | null;
  proxyNotice: string; clockOrderValid: boolean;
};
const elapsed = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;

/** Session-only identity; timestamps make IDs unique across process restarts.
 * This observer never changes detector state, clocks, GPS, or event boundaries. */
export class StopLatencyTracker {
  private episode?: { id: string; phase: 'stop' | 'resume'; low: number | null; observed: number | null; detected: number | null };
  annotate(runId: string, entry: StopDiagnostic, timing: { callbackAt: number; submittedAt: number; enteredAt: number; evaluatedAt: number; finishedAt: number }): StopDiagnostic {
    const phase = entry.decision === 'STOP_CONFIRMED' ? 'stop' : entry.decision === 'RESUME_CONFIRMED' || entry.state === 'AUTO_STOP' ? 'resume' : 'stop';
    if (this.episode?.phase !== phase) this.episode = undefined;
    const low = phase === 'stop' && entry.speed !== undefined && entry.speed >= 0 && entry.speed <= .35 && (entry.accuracy ?? Infinity) <= 20;
    const candidate = entry.candidateStartedAt !== undefined;
    if (!this.episode && (low || candidate)) this.episode = { id: `${runId}:${phase}:${entry.timestamp}`, phase, low: null, observed: null, detected: null };
    const e = this.episode;
    if (e && low && e.low === null) e.low = entry.timestamp;
    if (e && candidate && e.detected === null) { e.observed = entry.candidateStartedAt!; e.detected = timing.finishedAt; }
    const pipeline: StopPipelineData = { candidateId: e?.id ?? null, phase, sampleAt: entry.timestamp, ...timing,
      deliveryLagMs: elapsed(entry.timestamp, timing.callbackAt), repositoryWaitMs: elapsed(timing.submittedAt, timing.enteredAt),
      evaluationMs: elapsed(timing.evaluatedAt, timing.finishedAt), lowSpeedObservedAt: e?.low ?? null,
      candidateObservedAt: e?.observed ?? null, candidateDetectedAt: e?.detected ?? null,
      proxyNotice: 'GPS low speed is an observation proxy, not physical stopping time; receivedAt is JS task delivery, not native GNSS arrival.',
      clockOrderValid: timing.callbackAt >= entry.timestamp && timing.enteredAt >= timing.submittedAt && timing.finishedAt >= timing.evaluatedAt };
    if (['RESET', 'STOP_CONFIRMED', 'RESUME_CONFIRMED', 'SKIP'].includes(entry.decision) || e && !low && !candidate && entry.window?.stopEvidence === 'none') this.episode = undefined;
    return { ...entry, receivedAt: timing.callbackAt, pipeline };
  }
}

export function stopDecisionEvidence(entry: StopDiagnostic) {
  return { thresholds: MOVEMENT_THRESHOLDS, gates: entry.window ? movementGates(entry.window as Parameters<typeof movementGates>[0]) : null,
    reason: entry.reason ?? null, decision: entry.decision, speed: entry.speed ?? null, accuracy: entry.accuracy ?? null,
    intervalMs: entry.intervalMs ?? null, candidateAgeMs: entry.candidateAgeMs ?? null,
    displacement: entry.displacement ?? null, derivedSpeed: entry.effectiveSpeed ?? null, window: entry.window ?? null };
}

type LogEntry = { id?: string; type?: string; status?: string; loggedAt?: number; generatedAt?: number; dispatchedAt?: number;
  nativeQueuedAt?: number; startedAt?: number; data?: Record<string, unknown> };
export function summarizeStopLatency(entries: LogEntry[], runId?: string) {
  const rows = entries.filter(e => !runId || e.data?.runId === runId);
  const bins: Record<string, number[]> = {};
  const add = (key: string, value: number | null | undefined) => { if (typeof value === 'number' && Number.isFinite(value) && value >= 0) (bins[key] ??= []).push(value); };
  const reasons: Record<string, number> = {}, statuses: Record<string, number> = {};
  const candidates = new Map<string, { candidateId: string; phase: string; lowSpeedObservedAt: number | null; candidateDetectedAt: number | null; decisionAt: number | null; confirmedSampleAt: number | null }>();
  const seen = new Set<string>();
  for (const e of rows) {
    const key = `${e.id}:${e.type}:${e.status}:${e.loggedAt}`; if (seen.has(key)) continue; seen.add(key);
    if (e.status) statuses[e.status] = (statuses[e.status] ?? 0) + 1;
    if (e.type === 'STOP_CHECKPOINT' && e.status === 'COMPLETED' && typeof e.data?.durationMs === 'number') add('checkpointMs', e.data.durationMs);
    if (e.type === 'STOP_PIPELINE') {
      const p = e.data?.pipeline as StopPipelineData | undefined;
      if (!p) continue;
      add('gpsToJsCallbackMs', p.deliveryLagMs); add('repositoryQueueMs', p.repositoryWaitMs); add('detectorEvaluationMs', p.evaluationMs);
      const evidence = e.data?.evidence as ReturnType<typeof stopDecisionEvidence> | undefined;
      if (evidence?.reason) reasons[evidence.reason] = (reasons[evidence.reason] ?? 0) + 1;
      if (p.candidateId) {
        const c = candidates.get(p.candidateId) ?? { candidateId: p.candidateId, phase: p.phase, lowSpeedObservedAt: null, candidateDetectedAt: null, decisionAt: null, confirmedSampleAt: null };
        c.lowSpeedObservedAt ??= p.lowSpeedObservedAt; c.candidateDetectedAt ??= p.candidateDetectedAt;
        if (e.status === 'STOP_CONFIRMED' || e.status === 'RESUME_CONFIRMED') {
          c.decisionAt = p.finishedAt; c.confirmedSampleAt = p.sampleAt;
          add('candidateToConfirmationMs', c.candidateDetectedAt === null ? null : elapsed(c.candidateDetectedAt, p.finishedAt));
          add('lowSpeedProxyToConfirmationMs', c.lowSpeedObservedAt === null ? null : elapsed(c.lowSpeedObservedAt, p.finishedAt));
        }
        candidates.set(p.candidateId, c);
      }
    }
    if (e.status === 'QUEUED') {
      add('generationToNativeQueueMs', e.nativeQueuedAt && e.generatedAt ? elapsed(e.generatedAt, e.nativeQueuedAt) : null);
      add('dispatchToNativeQueueMs', e.nativeQueuedAt && e.dispatchedAt ? elapsed(e.dispatchedAt, e.nativeQueuedAt) : null);
      const confirmed = e.data?.confirmedAt;
      const created = e.generatedAt ?? (e as LogEntry & { queuedAt?: number }).queuedAt;
      if (typeof confirmed === 'number' && created) add('confirmationSampleToGenerationMs', elapsed(confirmed, created));
    }
    if (e.status === 'STARTED') {
      const lag = e.startedAt && e.nativeQueuedAt ? elapsed(e.nativeQueuedAt, e.startedAt) : null;
      add('nativeQueueToTtsStartMs', lag); add(`${e.type}:nativeQueueToTtsStartMs`, lag);
    }
    if (e.status === 'CHIME_STARTED') add('nativeQueueToChimeStartMs', e.loggedAt && e.nativeQueuedAt ? elapsed(e.nativeQueuedAt, e.loggedAt) : null);
  }
  const stages = Object.fromEntries(Object.entries(bins).map(([key, values]) => {
    values.sort((a, b) => a - b); const q = (n: number) => values[Math.max(0, Math.ceil(n * values.length) - 1)];
    return [key, { count: values.length, min: values[0], median: q(.5), p95: q(.95), max: values.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length }];
  }));
  return { schema: 1, runId: runId ?? null, stages, reasons, statuses, candidates: [...candidates.values()],
    limitations: ['Missing stages are unknown, never zero.', 'JS callback time includes native-to-JS delivery; native provider arrival is unavailable.',
      'GPS low-speed onset is not physical stopping time.', 'Rows may be truncated by journal retention; sample-based confirmation and processing time are separate.'] };
}
