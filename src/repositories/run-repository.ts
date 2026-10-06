import { applyRecovery, undoRecovery } from '@/utils/run-recovery';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isExpiredTrash, isTrashedRun, TrashedRun } from '@/utils/run-trash';
import { ActiveRun, LocationPoint, RunRecord, RunState } from '@/types/run';
import { detectStop, effectiveDistance, recordDiagnostic, stateOf, stopIntervals, transition } from '@/utils/run-model';
import { previewImport, validateRuns } from '@/utils/run-backup';
import { GpsObservationSession, incrementObservationCount, RawLocationObservation } from '@/utils/gps-observation';


const RUNS_KEY = '@runjourney/runs/v1';
const ACTIVE_RUN_KEY = '@runjourney/active-run/v1';

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

function parseArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// Unlike legacy permissive reads, destructive lifecycle operations fail closed on corrupt storage.
async function readHistory(): Promise<RunRecord[]> {
  const stored = await AsyncStorage.getItem(RUNS_KEY);
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || parsed.some(run => !run || typeof run.id !== 'string' || typeof run.endedAt !== 'string')) {
    throw new Error('履歴データを読み込めませんでした');
  }
  return parsed as RunRecord[];
}

async function loadRetainedRuns(now: number): Promise<RunRecord[]> {
  const runs = await readHistory();
  const retained = runs.filter(run => !isExpiredTrash(run, now));
  if (retained.length !== runs.length) await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(retained));
  return retained;
}

export const RunRepository = {
  /** Read-only snapshot, including expired trash; never invokes lifecycle purge. */
  getBackupRuns(): Promise<RunRecord[]> {
    return serialized(readHistory);
  },

  importRuns(incoming: RunRecord[]): Promise<{ added: number; skipped: number }> {
    // Clone before queueing: later caller mutations cannot change approved input.
    validateRuns(incoming);
    const snapshot: RunRecord[] = JSON.parse(JSON.stringify(incoming));
    return serialized(async () => {
      validateRuns(snapshot);
      const current = await readHistory();
      const { additions, duplicates } = previewImport(snapshot, current);
      // Protect the identity of an unfinished run, without modifying its storage.
      const active = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      const activeId = active ? JSON.parse(active).id : undefined;
      if (additions.some(run => run.id === activeId)) throw new Error('進行中の記録とIDが一致します。走行終了後に再確認してください');
      if (additions.length) await AsyncStorage.setItem(RUNS_KEY, JSON.stringify([...current, ...additions]));
      return { added: additions.length, skipped: duplicates };
    });
  },

  /** Compatibility API: normal consumers only receive active, completed history. */
  getRuns(): Promise<RunRecord[]> {
    return RunRepository.getActiveRuns();
  },

  getActiveRuns(): Promise<RunRecord[]> {
    return serialized(async () => (await loadRetainedRuns(Date.now())).filter(run => run.trashedAt == null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
  },

  getTrashedRuns(): Promise<TrashedRun[]> {
    return serialized(async () => (await loadRetainedRuns(Date.now())).filter(isTrashedRun)
      .sort((a, b) => b.trashedAt - a.trashedAt));
  },

  moveToTrash(runId: string): Promise<void> {
    return serialized(async () => {
      const runs = await readHistory();
      const run = runs.find(record => record.id === runId);
      if (!run) throw new Error('記録が見つかりません');
      if (run.trashedAt != null) return; // Repeated moves never extend retention.
      run.trashedAt = Date.now();
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
    });
  },

  restoreFromTrash(runId: string): Promise<void> {
    return serialized(async () => {
      const runs = await loadRetainedRuns(Date.now());
      const run = runs.find(record => record.id === runId);
      if (!run) throw new Error('記録が見つかりません。保持期間を過ぎた記録は復元できません');
      if (run.trashedAt == null) return;
      delete run.trashedAt;
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
    });
  },

  deletePermanently(runId: string): Promise<void> {
    return serialized(async () => {
      const runs = await readHistory();
      const run = runs.find(record => record.id === runId);
      if (!run) return;
      if (run.trashedAt == null) throw new Error('完全削除できるのはごみ箱の記録だけです');
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs.filter(record => record.id !== runId)));
    });
  },

  purgeExpiredTrash(now = Date.now()): Promise<number> {
    return serialized(async () => {
      const runs = await readHistory();
      const retained = runs.filter(run => !isExpiredTrash(run, now));
      if (retained.length !== runs.length) await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(retained));
      return runs.length - retained.length;
    });
  },

  setStopInclusion(runId: string, intervalId: string, included: boolean): Promise<RunRecord> {
    return serialized(async () => {
      const runs = parseArray<RunRecord>(await AsyncStorage.getItem(RUNS_KEY));
      const index = runs.findIndex(run => run.id === runId);
      const original = runs[index];
      if (original?.recovery) throw new Error('停止区間を訂正するには先に元の記録へ戻してください');
      if (!original || original.trashedAt != null || !stopIntervals(original).some(interval => interval.id === intervalId)) throw new Error('停止区間が見つかりません');
      const updated = { ...original, stopOverrides: { ...original.stopOverrides, [intervalId]: { included, updatedAt: new Date().toISOString() } } };
      // Original timestamps, events, points and original distance remain intact.
      runs[index] = updated;
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
      return updated;
    });
  },

  setRecovery(runId: string, enabled: boolean): Promise<RunRecord> {
    return serialized(async () => {
      const runs = await readHistory();
      const index = runs.findIndex(r => r.id === runId && r.trashedAt == null);
      if (index < 0) throw new Error('記録が見つかりません');
      runs[index] = enabled ? applyRecovery(runs[index]) : undoRecovery(runs[index]);
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
      return runs[index];
    });
  },

  diagnosticError(): Promise<void> {
    return serialized(async () => {
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return;
      const run: ActiveRun = observationSession?.active ?? JSON.parse(stored);
      if (!run.diagnostics) return;
      run.diagnostics.counts.TASK_ERROR = (run.diagnostics.counts.TASK_ERROR ?? 0) + 1;
      await AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
    });
  },

  getActiveRun(): Promise<ActiveRun | null> {
    return serialized(async () => {
      if (observationSession) return observationSession.active;
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return null;
      try {
        return JSON.parse(stored) as ActiveRun;
      } catch {
        return null;
      }
    });
  },

  saveActiveRun(run: ActiveRun): Promise<void> {
    return serialized(() => { observationSession = null; return AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run)); });
  },

  clearActiveRun(): Promise<void> {
    return serialized(() => { observationSession = null; return AsyncStorage.removeItem(ACTIVE_RUN_KEY); });
  },

  /** Test PoC entry point: RAM observations, shared detector, throttled GPS/storage. */
  appendActiveObservations(raws: RawLocationObservation[], appState = 'unknown'): Promise<ActiveRun | null> {
    return serialized(async () => {
      if (!observationSession) {
        const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
        if (!stored) return null;
        const active: ActiveRun = JSON.parse(stored);
        const counts = { ...(active.diagnostics?.counts ?? {}) };
        incrementObservationCount(counts, 'SEGMENTS');
        active.diagnostics = { ...active.diagnostics, entries: active.diagnostics?.entries ?? [], processed: active.diagnostics?.processed ?? 0, counts };
        observationSession = { active, observation: new GpsObservationSession(active.points.at(-1)?.timestamp, counts.GPS_OBS_LAST_TIMESTAMP), needsCheckpoint: false };
      }
      let active = observationSession.active;
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
        await AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(active));
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
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return null;

      let active = JSON.parse(stored) as ActiveRun;
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
      await AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(updated));
      return updated;
    });
  },

  transition(state: RunState, timestamp: number): Promise<ActiveRun | null> {
    return serialized(async () => {
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return null;
      const original: ActiveRun = flushObservation(observationSession?.active ?? JSON.parse(stored), timestamp);
      let run = transition(original, state, timestamp, 'user');
      if (stateOf(run) !== stateOf(original)) run = recordDiagnostic(run, { timestamp, state: stateOf(run), decision: 'RESET', reason: 'STATE_CHANGED' });
      if (observationSession) run.distanceMeters = effectiveDistance(run);
      await AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
      if (observationSession) observationSession.active = run;
      return run;
    });
  },

  finishActiveRun(endedAt: string): Promise<RunRecord | null> {
    return serialized(async () => {
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return null;

      const active = flushObservation(observationSession?.active ?? JSON.parse(stored) as ActiveRun, Date.parse(endedAt));
      const record: RunRecord = {
        ...active,
        detector: active.detector ? { ...active.detector, window: undefined } : undefined,
        endedAt,
        distanceMeters: effectiveDistance({ ...active, endedAt }),
        updatedAt: endedAt,
      };
      const runs = parseArray<RunRecord>(await AsyncStorage.getItem(RUNS_KEY));
      const withoutDuplicate = runs.filter((run) => run.id !== record.id);
      await AsyncStorage.multiSet([
        [RUNS_KEY, JSON.stringify([record, ...withoutDuplicate])],
      ]);
      await AsyncStorage.removeItem(ACTIVE_RUN_KEY);
      observationSession = null;
      return record;
    });
  },
};
