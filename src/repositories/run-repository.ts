import AsyncStorage from '@react-native-async-storage/async-storage';

import { ActiveRun, LocationPoint, RunRecord } from '@/types/run';
import { calculateDistance } from '@/utils/distance';

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

      const active = JSON.parse(stored) as ActiveRun;
      const seen = new Set(active.points.map((point) => point.timestamp));
      const merged = [...active.points, ...points.filter((point) => !seen.has(point.timestamp))]
        .sort((a, b) => a.timestamp - b.timestamp);
      const updated: ActiveRun = {
        ...active,
        points: merged,
        distanceMeters: calculateDistance(merged),
        updatedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(updated));
      return updated;
    });
  },

  finishActiveRun(endedAt: string): Promise<RunRecord | null> {
    return serialized(async () => {
      const stored = await AsyncStorage.getItem(ACTIVE_RUN_KEY);
      if (!stored) return null;

      const active = JSON.parse(stored) as ActiveRun;
      const record: RunRecord = {
        ...active,
        endedAt,
        distanceMeters: calculateDistance(active.points),
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
