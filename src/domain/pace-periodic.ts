import { ActiveRun } from '@/types/run';
import { paceAnnouncementMessage, validPaceState } from './pace-workout';
import { spokenDuration } from './voice-guidance';
import { paceEvidence } from './pace-evidence';

/** Speech-only data: never written into the RUN/GPS persistence model. */
export type PaceSchedule = { version: 1; runId: string; startedAt: number; intervalMs: number; enabled: boolean; configKey: string; targetSecPerKm: number };
export type PacePeriodicCursor = { acceptedThrough: number; activeFromMs: number };
export type PacePeriodicSnapshot = {
  version: 1; runId: string; configKey: string; slot: number; startAt: number; endAt: number;
  quality: 'READY' | 'DATA_INSUFFICIENT' | 'CANCELLED_NO_RUNNING' | 'CONFIG_CHANGED';
  reason: string; message: string; activeMs: number;
  startDistanceMeters?: number; distanceMeters?: number; startSavingsSec?: number; savingsSec?: number;
  intervalNumeric?: boolean; cumulativeNumeric?: boolean;
  intervalQuality?: 'MEASURED' | 'ESTIMATED' | 'UNAVAILABLE';
  cumulativeQuality?: 'MEASURED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
  intervalDistanceMeters?: number; intervalSavingsSec?: number; asOfAt?: number;
  qualityReasons?: string[];
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
  const evidence = paceEvidence(run, now, schedule.targetSecPerKm);
  const snapshots: PacePeriodicSnapshot[] = [];
  for (let slot = cursor.acceptedThrough + 1; slot <= due && snapshots.length < PACE_PERIODIC_MAX_BATCH; slot++) {
    const endAt = schedule.startedAt + slot * schedule.intervalMs, startAt = endAt - schedule.intervalMs;
    if (endAt > settledAt || candidateAt !== undefined && candidateAt <= endAt) break;
    // A fixed tick often precedes delivery of the bracketing GPS fix. Allow
    // that fix to arrive before declaring a permanent data deficit.
    if (now < endAt + PACE_BOUNDARY_SETTLE_MS && !run.points.some(p => p.timestamp >= endAt && p.timestamp <= now)) break;
    const base = { version: 1 as const, runId: run.id, configKey: schedule.configKey, slot, startAt, endAt };
    const startActive = evidence.activeAt(startAt), endActive = evidence.activeAt(endAt), activeMs = endActive - startActive;
    if (startAt < cursor.activeFromMs) {
      snapshots.push({ ...base, quality: 'CONFIG_CHANGED', reason: 'SETTING_CHANGED_WITHIN_INTERVAL', message: '', activeMs });
      continue;
    }
    if (activeMs <= 0 && evidence.validClockAt(endAt)) {
      snapshots.push({ ...base, quality: 'CANCELLED_NO_RUNNING', reason: 'NO_ACTIVE_RUNNING', message: '', activeMs });
      continue;
    }
    const end = evidence.boundary(endAt), interval = evidence.interval(startAt, endAt);
    const flags = [...new Set([...end.warnings, ...interval.warnings])];
    if (!end.numeric) {
      snapshots.push({ ...base, quality: 'DATA_INSUFFICIENT', reason: evidence.validClockAt(endAt) ? 'NO_VALID_DISTANCE_TIME_BASIS' : 'CLOCK_OR_STATE_INVALID', activeMs,
        intervalNumeric: false, cumulativeNumeric: false, intervalQuality: 'UNAVAILABLE', cumulativeQuality: 'UNAVAILABLE', qualityReasons: flags,
        message: '直近区間はデータ不足です。有効な距離・時間を確認できないため、累計は不明です。' });
      continue;
    }
    const sample = { runId: run.id, at: endAt, meters: end.meters, savings: end.savings, target: schedule.targetSecPerKm };
    let totals = paceAnnouncementMessage(sample);
    if (end.warnings.length || end.stale) totals = totals.replace(/(\d+(?:\.\d+)?)キロを通過/, '約$1キロを通過').replace(/(貯金|遅れ)は/, '$1は約');
    let message: string;
    if (interval.numeric) {
      const full = paceAnnouncementMessage(sample, { ...sample, at:startAt, meters:end.meters-interval.meters, savings:end.savings-interval.savings });
      const change = full.slice(0, full.length-paceAnnouncementMessage(sample).length);
      message = (interval.warnings.length ? '直近区間は概算です。' : '') + change + totals;
    } else message = '直近区間はデータ不足です。' + totals;
    if (end.stale) message = `最終の有効GPSで確認できた実走${spokenDuration(end.activeMs/1000)}時点の値です。` + message.replace('ここまでの走行で', 'この時点の記録で');
    snapshots.push({ ...base, quality:'READY', reason:end.stale?'STALE_CUMULATIVE':interval.numeric?'RECORDED_BOUNDARY_SNAPSHOT':'CUMULATIVE_ONLY', activeMs,
      intervalNumeric:interval.numeric,cumulativeNumeric:true,intervalQuality:interval.numeric?(interval.warnings.length?'ESTIMATED':'MEASURED'):'UNAVAILABLE',
      cumulativeQuality:end.stale?'STALE':end.warnings.length?'ESTIMATED':'MEASURED',qualityReasons:flags,asOfAt:end.asOfAt,
      ...(interval.numeric?{intervalDistanceMeters:interval.meters,intervalSavingsSec:interval.savings}:{}),
      ...(interval.numeric?{startDistanceMeters:end.meters-interval.meters,startSavingsSec:end.savings-interval.savings}:{}),
      distanceMeters:end.meters,savingsSec:end.savings,message });
  }
  return snapshots;
}
