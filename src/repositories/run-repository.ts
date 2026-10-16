import { applyRecovery, undoRecovery } from '@/utils/run-recovery';
import { database } from './database';
import { SqlSnapshot } from './sqlite-store';
import { validateSnapshot } from './sqlite-backup';

import { isTrashedRun, TrashedRun, TRASH_RETENTION_MS } from '@/utils/run-trash';
import { ActiveRun, LocationPoint, RunRecord, RunState } from '@/types/run';
import { detectStop, effectiveDistance, recordDiagnostic, stateOf, stopIntervals, transition } from '@/utils/run-model';
import { validateRuns } from '@/utils/run-backup';
import { GpsObservationSession, incrementObservationCount, RawLocationObservation } from '@/utils/gps-observation';


let operationQueue: Promise<unknown> = Promise.resolve();
let observationSession: { active: ActiveRun; observation: GpsObservationSession; needsCheckpoint: boolean } | null = null;

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
      if (observationSession) return observationSession.active;
      const stored = await (await database()).getDraft();
      if (!stored) return null;
      const run = stored as ActiveRun;
      if (!run || typeof run.id !== 'string' || !Array.isArray(run.points)) throw new Error('計測中の記録を読み込めませんでした。新規計測を開始せず確認してください');
      return run;
    });
  },

  saveActiveRun(run: ActiveRun): Promise<void> {
    return serialized(() => { observationSession = null; return database().then(db => db.saveDraft(run)); });
  },

  clearActiveRun(): Promise<void> {
    return serialized(() => { observationSession = null; return database().then(db => db.clearDraft()); });
  },

  /** Test PoC entry point: RAM observations, shared detector, throttled GPS/storage. */
  appendActiveObservations(raws: RawLocationObservation[], appState = 'unknown'): Promise<ActiveRun | null> {
    return serialized(async () => {
      if (!observationSession) {
        const stored = await (await database()).getDraft();
        if (!stored) return null;
        const active: ActiveRun = stored;
        const counts = { ...(active.diagnostics?.counts ?? {}) };
        incrementObservationCount(counts, 'SEGMENTS');
        active.diagnostics = { ...active.diagnostics, entries: active.diagnostics?.entries ?? [], processed: active.diagnostics?.processed ?? 0, counts };
        observationSession = { active, observation: new GpsObservationSession(active.points.at(-1)?.timestamp, counts.GPS_OBS_LAST_TIMESTAMP), needsCheckpoint: false };
      }
      let active = observationSession.active;
        if (active.endedAt) return active;
      const previousEventCount = active.events?.length ?? 0;
      const counts = { ...active.diagnostics!.counts };
      const incoming = observationSession.observation.ingest(raws, counts, appState, Date.parse(active.startedAt));
      active = { ...active, diagnostics: { ...active.diagnostics!, counts } };
      const persisted: LocationPoint[] = [];
      for (const { point, persist, window } of incoming) {
        active = detectStop(active, point, 'live-observation', window);
        if (persist) persisted.push(point);
      }
      active = { ...active, points: [...active.points, ...persisted], updatedAt: new Date().toISOString() };
      if (persisted.length || (active.events?.length ?? 0) !== previousEventCount) {
        active.distanceMeters = effectiveDistance(active);
        observationSession.needsCheckpoint = true;
      }
      observationSession.active = active;
      if (observationSession.needsCheckpoint) {
        await (await database()).saveDraft(active);
        observationSession.needsCheckpoint = false;
      }
      return active;
    });
  },

  getRecentObservations(windowMs = 10_000, now = Date.now()) {
    return serialized(async () => observationSession?.observation.buffer.getRecent(windowMs, now) ?? []);
  },

  appendActivePoints(points: LocationPoint[]): Promise<ActiveRun | null> {
    return serialized(async () => {
      const stored = await (await database()).getDraft();
      if (!stored) return null;

      let active = stored as ActiveRun;
        if (active.endedAt) return active;
      const seen = new Set(active.points.map((point) => point.timestamp));
      const incoming = points.filter(point => { if (seen.has(point.timestamp)) return false; seen.add(point.timestamp); return true; });
      const merged = [...active.points, ...incoming]
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const point of incoming.sort((a, b) => a.timestamp - b.timestamp).filter(p => p.timestamp >= (active.points.at(-1)?.timestamp ?? Date.parse(active.startedAt)))) active = detectStop(active, point, 'live-persisted');
      const updated: ActiveRun = {
        ...active,
        points: merged,
        distanceMeters: effectiveDistance({ ...active, points: merged }),
        updatedAt: new Date().toISOString(),
      };
      await (await database()).saveDraft(updated);
      return updated;
    });
  },

  transition(state: RunState, timestamp: number): Promise<ActiveRun | null> {
    return serialized(async () => {
      const stored = await (await database()).getDraft();
      if (!stored) return null;
      const original: ActiveRun = flushObservation(observationSession?.active ?? stored, timestamp);
      if (original.endedAt) return original;
      let run = transition(original, state, timestamp, 'user');
      if (stateOf(run) !== stateOf(original)) run = recordDiagnostic(run, { timestamp, state: stateOf(run), decision: 'RESET', reason: 'STATE_CHANGED' });
      if (observationSession) run.distanceMeters = effectiveDistance(run);
      await (await database()).saveDraft(run);
      if (observationSession) observationSession.active = run;
      return run;
    });
  },

  finishActiveRun(endedAt: string): Promise<RunRecord | null> {
    return serialized(async () => {
      const stored = await (await database()).getDraft();
      if (!stored) return null;

      const draft: ActiveRun = observationSession?.active ?? stored;
      endedAt = draft.endedAt ?? endedAt;
      const active = flushObservation(draft, Date.parse(endedAt));
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
      return saved;
    });
  },
};
