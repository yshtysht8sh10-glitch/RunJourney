import { RunRecord } from '@/types/run';

export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export type TrashedRun = RunRecord & { trashedAt: number };
export function isTrashedRun(run: RunRecord): run is TrashedRun {
  return run.trashedAt != null;
}
export function isExpiredTrash(run: RunRecord, now: number): boolean {
  return isTrashedRun(run) && Number.isFinite(run.trashedAt) && run.trashedAt >= 0
    && run.trashedAt + TRASH_RETENTION_MS <= now;
}
