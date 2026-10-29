import { applyRecovery, undoRecovery } from '@/utils/run-recovery';
import { database } from './database';
import { SqlitePagedStore } from './paged-store';
import type { PagedRunSource } from '../domain/pages';
import { SqlSnapshot } from './sqlite-store';
import { validateSnapshot } from './sqlite-backup';

import { isTrashedRun, TrashedRun, TRASH_RETENTION_MS } from '@/utils/run-trash';
import { ActiveRun, LocationPoint, RunRecord, RunState } from '@/types/run';
import { detectStop, effectiveDistance, recordDiagnostic, stateOf, stopIntervals, transition } from '@/utils/run-model';
import { validateRuns } from '@/utils/run-backup';
import { GpsObservationSession, incrementObservationCount, RawLocationObservation } from '@/utils/gps-observation';
import { safelyAdvancePaceWorkout } from '@/domain/pace-workout';
import { goalAchievement } from '@/domain/finish-goal';
import { StopLatencyTracker, stopDecisionEvidence } from '@/domain/stop-latency';
import { diagnosticLog } from '@/services/diagnostic-log';
import { LatestCheckpoint } from './latest-checkpoint';


let operationQueue: Promise<unknown> = Promise.resolve();
let observationSession: { active: ActiveRun; observation: GpsObservationSession; needsCheckpoint: boolean; latency: StopLatencyTracker } | null = null;
let pendingFinish: ActiveRun | null = null;
const checkpoints = new LatestCheckpoint<ActiveRun>(async active => {
  const startedAt = Date.now();
  try {
    await (await database()).saveDraft(active);
    diagnosticLog('STOP_CHECKPOINT', active.id + ':checkpoint:' + startedAt, 'COMPLETED', { runId: active.id, startedAt, finishedAt: Date.now(), durationMs: Date.now() - startedAt, sampleAt: active.detector?.last?.timestamp, pointCount: active.points.length });
  } catch (error) {
    if (observationSession?.active.id === active.id) observationSession.needsCheckpoint = true;
    diagnosticLog('STOP_CHECKPOINT', active.id + ':checkpoint:' + startedAt, 'FAILED', { runId: active.id, durationMs: Date.now() - startedAt });
    throw error;
  }
}, error => console.warn('GPS checkpoint failed; RAM snapshot retained for retry', error));

function flushObservation(active: ActiveRun, endMs: number): ActiveRun {
  const pending = observationSession?.observation.latestPoint;
  if (!pending || pending.timestamp > endMs || !observationSession!.observation.gate.accept(pending.timestamp, true)) return active;
  const updated = { ...active, points: [...active.points, pending] };
  updated.distanceMeters = effectiveDistance(updated);
  observationSession!.active = updated;
  observationSession!.needsCheckpoint = true;
  return updated;
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export const RunRepository = {
  getReviewPage(limit = 100, offset = 0) { return serialized(async () => new SqlitePagedStore(await database()).list(limit, offset)); },
  pagedSource(id: string): PagedRunSource { return {
    summary: async () => new SqlitePagedStore(await database()).source(id).summary(),
    read: async (kind, start) => new SqlitePagedStore(await database()).source(id).read(kind, start),
  }; },
  async getStorageWarning() { return (await database()).diagnosticWarning; },
  pruneDiagnostics(before = new Date(Date.now()-30*86400000).toISOString()) {
    return serialized(async () => (await database()).pruneDiagnostics(before));
  },
  restoreSnapshot(snapshot: SqlSnapshot) {
    validateSnapshot(snapshot); const copy: SqlSnapshot = JSON.parse(JSON.stringify(snapshot));
    return serialized(async () => (await database()).restore(copy));
  },
  getBackupRuns(): Promise<RunRecord[]> { return serialized(async () => (await database()).list(true)); },
  importRuns(incoming: RunRecord[]): Promise<{ added: number; skipped: number }> {
    validateRuns(incoming);
    const snapshot: RunRecord[] = JSON.parse(JSON.stringify(incoming));
    return serialized(async () => (await database()).importRuns(snapshot));
  },
  getRun(id: string): Promise<RunRecord | null> {
    return serialized(async () => {
      const run = await (await database()).getRun(id);
      return run?.endedAt ? run as RunRecord : null;
    });
  },
  getHistoryPage(limit = 100, offset = 0) {
    return serialized(async () => (await database()).summaries(limit, offset));
  },
  getRuns(): Promise<RunRecord[]> { return RunRepository.getActiveRuns(); },
  getActiveRuns(): Promise<RunRecord[]> {
    return serialized(async () => {
      const db = await database(); await db.purgeTrash(Date.now() - TRASH_RETENTION_MS); return db.list();
    });
  },
  getTrashedRuns(): Promise<TrashedRun[]> {
    return serialized(async () => {
      const db = await database(); await db.purgeTrash(Date.now() - TRASH_RETENTION_MS);
      return (await db.list(true, true)).filter(isTrashedRun).sort((a,b) => b.trashedAt-a.trashedAt);
    });
  },
  moveToTrash(runId: string): Promise<void> {
    return serialized(async () => { await (await database()).update(runId, run => run.trashedAt == null ? { ...run, trashedAt: Date.now() } : run); });
  },
  restoreFromTrash(runId: string): Promise<void> {
    return serialized(async () => {
      const db = await database(); await db.purgeTrash(Date.now()-TRASH_RETENTION_MS);
      await db.update(runId, run => { const { trashedAt: _trash, ...restored } = run; return restored; });
    });
  },
  deletePermanently(runId: string): Promise<void> { return serialized(async () => (await database()).remove(runId)); },
  purgeExpiredTrash(now = Date.now()): Promise<number> { return serialized(async () => (await database()).purgeTrash(now-TRASH_RETENTION_MS)); },
  setStopInclusion(runId: string, intervalId: string, included: boolean): Promise<RunRecord> {
    return serialized(async () => (await database()).update(runId, run => {
      if (run.recovery) throw new Error('停止区間を訂正するには先に元の記録へ戻してください');
      if (run.trashedAt != null || !stopIntervals(run).some(interval => interval.id === intervalId)) throw new Error('停止区間が見つかりません');
      return { ...run, stopOverrides: { ...run.stopOverrides, [intervalId]: { included, updatedAt: new Date().toISOString() } } };
    }));
  },
  setRecovery(runId: string, enabled: boolean): Promise<RunRecord> {
    return serialized(async () => (await database()).update(runId, run => {
      if (run.trashedAt != null) throw new Error('記録が見つかりません');
      return enabled ? applyRecovery(run) : undoRecovery(run);
    }));
  },
  diagnosticError(): Promise<void> {
    return serialized(async () => {
      const stored = await (await database()).getDraft();
      if (!stored) return;
      const run: ActiveRun = observationSession?.active ?? stored;
      if (!run.diagnostics) return;
      run.diagnostics.counts.TASK_ERROR = (run.diagnostics.counts.TASK_ERROR ?? 0) + 1;
      await (await database()).saveDraft(run);
    });
  },

  getActiveRun(): Promise<ActiveRun | null> {
    return serialized(async () => {
      if (pendingFinish) return pendingFinish;
      if (observationSession) return observationSession.active;
      const stored = await (await database()).getDraft();
      if (!stored) return null;
      const run = stored as ActiveRun;
      if (!run || typeof run.id !== 'string' || !Array.isArray(run.points)) throw new Error('計測中の記録を読み込めませんでした。新規計測を開始せず確認してください');
      return run;
    });
  },

  saveActiveRun(run: ActiveRun): Promise<void> {
    return serialized(async () => { await checkpoints.flush(); await (await database()).saveDraft(run); observationSession = null; pendingFinish = null; });
  },

  clearActiveRun(): Promise<void> {
    return serialized(async () => { await checkpoints.flush(); observationSession = null; pendingFinish = null; return database().then(db => db.clearDraft()); });
  },

  /** Test PoC entry point: RAM observations, shared detector, throttled GPS/storage. */
  appendActiveObservations(raws: RawLocationObservation[], appState = 'unknown', onObserved?: (run: ActiveRun) => void): Promise<ActiveRun | null> {
    const submittedAt = Date.now();
    return serialized(async () => {
      const enteredAt = Date.now();
      if (pendingFinish) return pendingFinish;
      if (!observationSession) {
        const stored = await (await database()).getDraft();
        if (!stored) return null;
        const active: ActiveRun = stored;
        const counts = { ...(active.diagnostics?.counts ?? {}) };
        incrementObservationCount(counts, 'SEGMENTS');
        active.diagnostics = { ...active.diagnostics, entries: active.diagnostics?.entries ?? [], processed: active.diagnostics?.processed ?? 0, counts };
        observationSession = { active, observation: new GpsObservationSession(active.points.at(-1)?.timestamp, counts.GPS_OBS_LAST_TIMESTAMP), needsCheckpoint: false, latency: new StopLatencyTracker() };
      }
      let active = observationSession.active;
        if (active.endedAt) return active;
      const previousEventCount = active.events?.length ?? 0;
      const counts = { ...active.diagnostics!.counts };
      const incoming = observationSession.observation.ingest(raws, counts, appState, Date.parse(active.startedAt));
      active = { ...active, diagnostics: { ...active.diagnostics!, counts } };
      const persisted: LocationPoint[] = [];
      for (const { point, persist, window, receivedAt } of incoming) {
        const evaluatedAt = Date.now();
        active = detectStop(active, point, 'live-observation', window);
        const entry = active.diagnostics?.entries.at(-1);
        if (entry?.timestamp === point.timestamp && active.diagnostics) {
          const annotated = observationSession.latency.annotate(active.id, entry, { callbackAt: receivedAt, submittedAt, enteredAt, evaluatedAt, finishedAt: Date.now() });
          active = { ...active, diagnostics: { ...active.diagnostics, entries: [...active.diagnostics.entries.slice(0, -1), annotated], trace: active.diagnostics.trace?.map(e => e === entry ? annotated : e) } };
          diagnosticLog('STOP_PIPELINE', `${active.id}:sample:${point.timestamp}`, annotated.decision,
            { runId: active.id, appState, pipeline: annotated.pipeline, evidence: stopDecisionEvidence(annotated) });
        }
        if (persist) persisted.push(point);
      }
      active = { ...active, points: [...active.points, ...persisted], updatedAt: new Date().toISOString() };
      if (persisted.length || (active.events?.length ?? 0) !== previousEventCount) {
        active.distanceMeters = effectiveDistance(active);
        const previousEvaluation = active.paceWorkout?.evaluatedAt;
        active = safelyAdvancePaceWorkout(active, incoming.at(-1)?.point.timestamp ?? Date.now());
        const pace = active.paceWorkout;
        if (pace && pace.evaluatedAt !== previousEvaluation) diagnosticLog('PACE_EVALUATION', active.id + ':pace:' + pace.evaluatedAt,
          pace.notice ? 'CREATED' : !pace.voice ? 'VOICE_OFF' : stateOf(active) !== 'RUNNING' ? 'PAUSED' : pace.status === 'UNKNOWN' ? 'UNKNOWN_QUALITY' : 'INTERVAL_OR_STATE_CONDITION',
          { runId: active.id, evaluatedAt: pace.evaluatedAt, voice: pace.voice, minimumIntervalSec: pace.voiceIntervalSec, status: pace.status, lastVoiceAt: pace.lastVoiceAt, noticeId: pace.notice?.key ?? null });
        observationSession.needsCheckpoint = true;
      }
      observationSession.active = active;
      // Optional audio feedback sees RAM state before the checkpoint; failures
      // cannot cancel or delay durable GPS storage or change detector results.
      try { onObserved?.(active); } catch (error) { console.warn('Observation feedback failed', error); }
      if (observationSession.needsCheckpoint) {
        checkpoints.schedule(active);
        observationSession.needsCheckpoint = false;
      }
      return active;
    });
  },

  flushCheckpoint() { return checkpoints.flush(); },

  getRecentObservations(windowMs = 10_000, now = Date.now()) {
    // RAM-only immutable snapshot must not wait behind SQLite checkpoints.
    return Promise.resolve(observationSession?.observation.buffer.getRecent(windowMs, now) ?? []);
  },

  appendActivePoints(points: LocationPoint[]): Promise<ActiveRun | null> {
    return serialized(async () => {
      if (pendingFinish) return pendingFinish;
      const stored = await (await database()).getDraft();
      if (!stored) return null;

      let active = stored as ActiveRun;
        if (active.endedAt) return active;
      const seen = new Set(active.points.map((point) => point.timestamp));
      const incoming = points.filter(point => { if (seen.has(point.timestamp)) return false; seen.add(point.timestamp); return true; });
      const merged = [...active.points, ...incoming]
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const point of incoming.sort((a, b) => a.timestamp - b.timestamp).filter(p => p.timestamp >= (active.points.at(-1)?.timestamp ?? Date.parse(active.startedAt)))) active = detectStop(active, point, 'live-persisted');
      let updated: ActiveRun = {
        ...active,
        points: merged,
        distanceMeters: effectiveDistance({ ...active, points: merged }),
        updatedAt: new Date().toISOString(),
      };
      updated = safelyAdvancePaceWorkout(updated, incoming.at(-1)?.timestamp ?? Date.now());
      await (await database()).saveDraft(updated);
      return updated;
    });
  },

  transition(state: RunState, timestamp: number): Promise<ActiveRun | null> {
    return serialized(async () => {
      await checkpoints.flush();
      if (pendingFinish) return pendingFinish;
      const stored = await (await database()).getDraft();
      if (!stored) return null;
      const original: ActiveRun = flushObservation(observationSession?.active ?? stored, timestamp);
      if (original.endedAt) return original;
      let run = transition(original, state, timestamp, 'user');
      if (stateOf(run) !== stateOf(original)) run = recordDiagnostic(run, { timestamp, state: stateOf(run), decision: 'RESET', reason: 'STATE_CHANGED' });
      if (observationSession) run.distanceMeters = effectiveDistance(run);
      run = safelyAdvancePaceWorkout(run, timestamp, true);
      await (await database()).saveDraft(run);
      if (observationSession) observationSession.active = run;
      return run;
    });
  },

  /** Serialized with GPS writes: freeze before waiting for OS tracking shutdown. */
  prepareFinish(endedAt: string, automatic = false, expectedId?: string): Promise<ActiveRun | null> {
    return serialized(async () => {
      await checkpoints.flush();
      const stored = await (await database()).getDraft();
      if (!stored || expectedId && stored.id !== expectedId) return null;
      const draft = pendingFinish ?? observationSession?.active ?? stored;
      if (draft.endedAt) { await (await database()).saveDraft(draft); return draft; }
      const now = Date.parse(endedAt);
      const active = flushObservation(draft, now);
      const achievement = goalAchievement(active, now);
      if (automatic && !achievement) return null;
      const end = achievement ? new Date(achievement.reachedAt).toISOString() : endedAt;
      const frozen = { ...active, endedAt: end, ...(achievement ? { achievement } : {}), updatedAt: end };
      frozen.distanceMeters = effectiveDistance(frozen);
      // Retain a retryable RAM snapshot even if the first durable freeze fails.
      if (observationSession) observationSession.active = frozen;
      pendingFinish = frozen;
      await (await database()).saveDraft(frozen);
      return frozen;
    });
  },

  finishActiveRun(endedAt: string): Promise<RunRecord | null> {
    return serialized(async () => {
      await checkpoints.flush();
      const stored = await (await database()).getDraft();
      if (!stored) return null;

      const draft: ActiveRun = pendingFinish ?? observationSession?.active ?? stored;
      endedAt = draft.endedAt ?? endedAt;
      const active = safelyAdvancePaceWorkout(flushObservation(draft, Date.parse(endedAt)), Date.parse(endedAt), true);
      const record: RunRecord = {
        ...active,
        detector: active.detector ? { ...active.detector, window: undefined } : undefined,
        endedAt,
        distanceMeters: effectiveDistance({ ...active, endedAt }),
        updatedAt: endedAt,
      };
      // Freeze the STOP snapshot durably before writing history. Failed writes
      // can be retried after a restart without counting the retry wait as running.
      await (await database()).saveDraft(record);
      if (observationSession) observationSession.active = record;
      const saved = await (await database()).complete(record);
      observationSession = null;
      pendingFinish = null;
      return saved;
    });
  },
};
