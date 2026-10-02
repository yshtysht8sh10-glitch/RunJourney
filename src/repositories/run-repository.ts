import AsyncStorage from '@react-native-async-storage/async-storage';

import { ActiveRun, LocationPoint, RunRecord, RunState } from '@/types/run';
import { detectStop, effectiveDistance, recordDiagnostic, stateOf, stopIntervals, transition } from '@/utils/run-model';


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

export const RunRepository = {
  getRuns(): Promise<RunRecord[]> {
    return serialized(async () => {
      const runs = parseArray<RunRecord>(await AsyncStorage.getItem(RUNS_KEY));
      return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    });
  },

  setStopInclusion(runId: string, intervalId: string, included: boolean): Promise<RunRecord> {
    return serialized(async () => {
      const runs = parseArray<RunRecord>(await AsyncStorage.getItem(RUNS_KEY));
      const index = runs.findIndex(run => run.id === runId);
      const original = runs[index];
      if (!original || !stopIntervals(original).some(interval => interval.id === intervalId)) throw new Error('停止区間が見つかりません');
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
        distanceMeters: effectiveDistance(active),
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
