import { ActiveRun } from '@/types/run';
import { effectiveEdges, timeModel } from '@/utils/run-model';
import { usableObservation } from '@/utils/movement-inference';
import { distanceBetween } from '@/utils/distance';
import { paceAnnouncementMessage, validPaceState } from './pace-workout';

/** Speech-only data: never written into the RUN/GPS persistence model. */
export type PaceSchedule = { version: 1; runId: string; startedAt: number; intervalMs: number; enabled: boolean; configKey: string; targetSecPerKm: number };
export type PacePeriodicCursor = { acceptedThrough: number; activeFromMs: number };
export type PacePeriodicSnapshot = {
  version: 1; runId: string; configKey: string; slot: number; startAt: number; endAt: number;
  quality: 'READY' | 'DATA_INSUFFICIENT' | 'CANCELLED_NO_RUNNING' | 'CONFIG_CHANGED';
  reason: string; message: string; activeMs: number;
  startDistanceMeters?: number; distanceMeters?: number; startSavingsSec?: number; savingsSec?: number;
};
export const PACE_PERIODIC_MAX_BATCH = 32;
export const PACE_BOUNDARY_MAX_GAP_MS = 10000;
// The unchanged detector can backdate a stop. Do not seal a boundary while
// its observation window/candidate can still revise the effective time model.
export const PACE_BOUNDARY_SETTLE_MS = 15000;

export function paceSchedule(run: ActiveRun): PaceSchedule | undefined {
  const workout = run.paceWorkout;
  if (!validPaceState(workout)) return undefined;
  const startedAt = Date.parse(run.startedAt);
  const intervalMs = workout.voiceIntervalSec * 1000;
  const targetSecPerKm = workout.workout.segments[0].targetPaceSecPerKm;
  if (!Number.isFinite(startedAt) || !Number.isFinite(intervalMs) || intervalMs < 60000 || intervalMs > 600000) return undefined;
  return { version: 1, runId: run.id, startedAt, intervalMs, enabled: workout.voice && !run.endedAt,
    targetSecPerKm, configKey: `v1:${intervalMs}:${targetSecPerKm}` };
}

function activeAt(run: ActiveRun, at: number) {
  // Callers only supply active RUNs; avoid endedAt making timeModel ignore at.
  return timeModel({ ...run, endedAt: undefined }, at).activeRunningTime;
}

/** Cumulative quality is deliberate: an unmeasured earlier distance makes the
 * cumulative savings unknown too. Missing GPS is never replaced by speed or
 * extrapolated beyond the final fix. Fully stopped spans need no GPS fixes. */
function cumulativeQuality(run: ActiveRun, at: number): string | undefined {
  const start = Date.parse(run.startedAt);
  if (at === start) return undefined;
  const points = run.points;
  if (!points.length) return 'NO_GPS';
  const first = points[0];
  if (first.timestamp > start + PACE_BOUNDARY_MAX_GAP_MS && activeAt(run, Math.min(first.timestamp, at)) > 0) return 'START_GPS_GAP';
  const endIndex = points.findIndex(p => p.timestamp >= at);
  if (endIndex < 0) return 'BOUNDARY_NOT_BRACKETED';
  if (points.slice(0, endIndex + 1).some((p, i) => i > 0 && p.timestamp <= points[i - 1].timestamp)) return 'GPS_TIME_ORDER';
  if (!usableObservation(first)) return 'GPS_QUALITY';
  for (let i = 1; i <= endIndex; i++) {
    const before = points[i - 1], after = points[i];
    if (activeAt(run, Math.min(after.timestamp, at)) <= activeAt(run, Math.max(start, before.timestamp))) continue;
    if (!usableObservation(before) || !usableObservation(after)) return 'GPS_QUALITY';
    if (after.timestamp - before.timestamp > PACE_BOUNDARY_MAX_GAP_MS) return 'GPS_GAP';
    if (distanceBetween(before, after) / ((after.timestamp - before.timestamp) / 1000) > 12.5) return 'GPS_SPEED_SPIKE';
  }
  return undefined;
}

/** Produces deterministic, immutable interval values. Native must persist each
 * accepted snapshot before advancing acceptedThrough. No playback baseline is
 * used, so delayed/failed speech cannot move the next interval boundary. */
export function pacePeriodicSnapshots(run: ActiveRun, now: number, cursor: PacePeriodicCursor): PacePeriodicSnapshot[] {
  const schedule = paceSchedule(run);
  if (!schedule?.enabled || !Number.isFinite(now) || !Number.isSafeInteger(cursor.acceptedThrough) || cursor.acceptedThrough < 0
    || !Number.isFinite(cursor.activeFromMs) || cursor.activeFromMs < schedule.startedAt) return [];
  const due = Math.floor((now - schedule.startedAt) / schedule.intervalMs);
  const settledAt = run.features?.autoStop ? now - PACE_BOUNDARY_SETTLE_MS : now;
  const candidateAt = run.features?.autoStop ? run.detector?.stillSince : undefined;
  const cache = new Map<number, { reason?: string; meters: number; savings: number; activeMs: number }>();
  const boundary = (at: number) => {
    if (!cache.has(at)) {
      const activeMs = activeAt(run, at);
      const meters = effectiveEdges(run, at).reduce((sum, edge) => sum + edge.distanceMeters, 0);
      cache.set(at, { reason: cumulativeQuality(run, at), meters, activeMs, savings: schedule.targetSecPerKm * meters / 1000 - activeMs / 1000 });
    }
    return cache.get(at)!;
  };
  const snapshots: PacePeriodicSnapshot[] = [];
  for (let slot = cursor.acceptedThrough + 1; slot <= due && snapshots.length < PACE_PERIODIC_MAX_BATCH; slot++) {
    const endAt = schedule.startedAt + slot * schedule.intervalMs, startAt = endAt - schedule.intervalMs;
    if (endAt > settledAt || candidateAt !== undefined && candidateAt <= endAt) break;
    // A fixed tick often precedes delivery of the bracketing GPS fix. Allow
    // that fix to arrive before declaring a permanent data deficit.
    if (now < endAt + PACE_BOUNDARY_SETTLE_MS && !run.points.some(p => p.timestamp >= endAt)) break;
    const base = { version: 1 as const, runId: run.id, configKey: schedule.configKey, slot, startAt, endAt };
    const startActive = activeAt(run, startAt), endActive = activeAt(run, endAt), activeMs = endActive - startActive;
    if (startAt < cursor.activeFromMs) {
      snapshots.push({ ...base, quality: 'CONFIG_CHANGED', reason: 'SETTING_CHANGED_WITHIN_INTERVAL', message: '', activeMs });
      continue;
    }
    if (activeMs <= 0) {
      snapshots.push({ ...base, quality: 'CANCELLED_NO_RUNNING', reason: 'NO_ACTIVE_RUNNING', message: '', activeMs });
      continue;
    }
    const start = boundary(startAt), end = boundary(endAt);
    const reason = start.reason ?? end.reason;
    if (reason) {
      snapshots.push({ ...base, quality: 'DATA_INSUFFICIENT', reason, activeMs, message: 'この区間はデータが不足しているため、ペースをお知らせできません。' });
      continue;
    }
    const sample = { runId: run.id, at: endAt, meters: end.meters, savings: end.savings, target: schedule.targetSecPerKm };
    snapshots.push({ ...base, quality: 'READY', reason: 'BOUNDARY_SNAPSHOT', activeMs,
      startDistanceMeters: start.meters, distanceMeters: end.meters, startSavingsSec: start.savings, savingsSec: end.savings,
      message: paceAnnouncementMessage(sample, { ...sample, at: startAt, meters: start.meters, savings: start.savings }) });
  }
  return snapshots;
}
