import AsyncStorage from '@react-native-async-storage/async-storage';

import { isExpiredTrash, isTrashedRun, TrashedRun } from '@/utils/run-trash';
import { ActiveRun, LocationPoint, RunRecord, RunState } from '@/types/run';
import { detectStop, effectiveDistance, recordDiagnostic, stateOf, stopIntervals, transition } from '@/utils/run-model';
import { previewImport, validateRuns } from '@/utils/run-backup';


const RUNS_KEY = '@runjourney/runs/v1';
const ACTIVE_RUN_KEY = '@runjourney/active-run/v1';

let operationQueue: Promise<unknown> = Promise.resolve();

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
      if (!original || original.trashedAt != null || !stopIntervals(original).some(interval => interval.id === intervalId)) throw new Error('停止区間が見つかりません');
      const updated = { ...original, stopOverrides: { ...original.stopOverrides, [intervalId]: { included, updatedAt: new Date().toISOString() } } };
      // Original timestamps, events, points and original distance remain intact.
      runs[index] = updated;
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
      return updated;
    });
  },

  diagnosticError(): Promise<void> {
    return serialized(async () => {
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return;
      const run: ActiveRun = JSON.parse(stored);
      if (!run.diagnostics) return;
      run.diagnostics.counts.TASK_ERROR = (run.diagnostics.counts.TASK_ERROR ?? 0) + 1;
      await AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
    });
  },

  getActiveRun(): Promise<ActiveRun | null> {
    return serialized(async () => {
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
    return serialized(() => AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run)));
  },

  clearActiveRun(): Promise<void> {
    return serialized(() => AsyncStorage.removeItem(ACTIVE_RUN_KEY));
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
      for (const point of incoming.sort((a, b) => a.timestamp - b.timestamp).filter(p => p.timestamp >= (active.points.at(-1)?.timestamp ?? Date.parse(active.startedAt)))) active = detectStop(active, point);
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
      const original: ActiveRun = JSON.parse(stored);
      let run = transition(original, state, timestamp, 'user');
      if (stateOf(run) !== stateOf(original)) run = recordDiagnostic(run, { timestamp, state: stateOf(run), decision: 'RESET', reason: 'STATE_CHANGED' });
      await AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
      return run;
    });
  },

  finishActiveRun(endedAt: string): Promise<RunRecord | null> {
    return serialized(async () => {
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return null;

      let active = JSON.parse(stored) as ActiveRun;
      const record: RunRecord = {
        ...active,
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
      return record;
    });
  },
};
