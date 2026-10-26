import type { ActiveRun, LocationPoint } from '../types/run';
import { analyzePoints } from '../utils/pace-analysis';
import { inferMovement, usableObservation } from '../utils/movement-inference';
import { stateOf, timeModel } from '../utils/run-model';
import { savingsMessage, savingsSeconds } from './voice-guidance';

export type PaceStatus = 'FAST' | 'ON_TARGET' | 'SLOW' | 'UNKNOWN';
export type PaceSegment = {
  id: string;
  kind: 'warmup' | 'steady' | 'cooldown';
  targetPaceSecPerKm: number;
  toleranceSecPerKm: number;
  target: { type: 'distance'; meters: number } | { type: 'duration'; seconds: number };
};
export type PaceWorkout = { id: string; segments: PaceSegment[] };
export type PaceSettings = {
  enabled: boolean; distanceKm: number; paceSecPerKm: number;
  toleranceSecPerKm: number; voice: boolean; voiceIntervalSec: number;
};
export const DEFAULT_PACE_SETTINGS: PaceSettings = {
  enabled: false, distanceKm: 5, paceSecPerKm: 375, toleranceSecPerKm: 15,
  voice: false, voiceIntervalSec: 120,
};
export const targetTimeSeconds = (distanceKm: number, paceSecPerKm: number) => distanceKm * paceSecPerKm;
export const targetPaceSeconds = (distanceKm: number, seconds: number) => seconds / distanceKm;
export function validPaceSettings(value: unknown): value is PaceSettings {
  const s = value as PaceSettings | null;
  return !!s && typeof s.enabled === 'boolean' && typeof s.voice === 'boolean'
    && finiteRange(s.distanceKm, 0.1, 200) && finiteRange(s.paceSecPerKm, 120, 1800)
    && finiteRange(s.toleranceSecPerKm, 0, 120) && finiteRange(s.voiceIntervalSec, 60, 600)
    && targetTimeSeconds(s.distanceKm, s.paceSecPerKm) <= 48 * 3600;
}
function finiteRange(n: number, min: number, max: number) { return Number.isFinite(n) && n >= min && n <= max; }
export function validWorkout(value: unknown): value is PaceWorkout {
  const w = value as PaceWorkout | null;
  return !!w && typeof w.id === 'string' && w.id.length > 0 && w.id.length <= 100
    && Array.isArray(w.segments) && w.segments.length > 0 && w.segments.length <= 32
    && new Set(w.segments.map(s => s?.id)).size === w.segments.length
    && w.segments.every(s => s && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 100
      && ['warmup', 'steady', 'cooldown'].includes(s.kind)
      && finiteRange(s.targetPaceSecPerKm, 120, 1800) && finiteRange(s.toleranceSecPerKm, 0, 120)
      && (s.target?.type === 'distance' ? finiteRange(s.target.meters, 100, 200_000)
        : s.target?.type === 'duration' && finiteRange(s.target.seconds, 30, 48 * 3600)));
}
export function steadyWorkout(settings: PaceSettings): PaceWorkout {
  if (!validPaceSettings(settings)) throw new Error('ペース走の設定値を確認してください');
  return { id: 'steady-v1', segments: [{ id: 'steady-1', kind: 'steady',
    targetPaceSecPerKm: settings.paceSecPerKm, toleranceSecPerKm: settings.toleranceSecPerKm,
    target: { type: 'distance', meters: settings.distanceKm * 1000 } }] };
}
/** Inclusive boundaries belong to ON_TARGET. Segment selection/execution is Phase 2. */
export function classifyPace(pace: number | null, segment: PaceSegment): PaceStatus {
  if (pace === null || !Number.isFinite(pace) || pace <= 0) return 'UNKNOWN';
  return pace < segment.targetPaceSecPerKm - segment.toleranceSecPerKm ? 'FAST'
    : pace > segment.targetPaceSecPerKm + segment.toleranceSecPerKm ? 'SLOW' : 'ON_TARGET';
}
export function segmentReached(segment: PaceSegment, distanceMeters: number, activeSeconds: number) {
  return segment.target.type === 'distance' ? distanceMeters >= segment.target.meters : activeSeconds >= segment.target.seconds;
}
export type UnknownReason = 'WARMUP' | 'GPS_QUALITY' | 'STATIONARY' | 'GAP';
export type PaceWorkoutState = {
  version: 1; workout: PaceWorkout; voice: boolean; voiceIntervalSec: number;
  evaluatedAt: number; accountedActiveMs: number; lastEventCount: number;
  status: PaceStatus; candidate: PaceStatus; consecutive: number;
  currentPace: number | null; delta: number | null;
  validMs: number; onTargetMs: number; unknownMs: number;
  unknownIntervals: { start: number; end: number; reason: UnknownReason }[];
  omittedUnknownIntervals: number; reached: boolean; lastVoiceAt: number;
  lastGuidedStatus: PaceStatus;
  notice?: { key: string; message: string; at: number; goal: boolean };
};
export function createPaceWorkout(settings: PaceSettings, startedAt: number): PaceWorkoutState | undefined {
  if (!settings.enabled) return undefined;
  return { version: 1, workout: steadyWorkout(settings), voice: settings.voice, voiceIntervalSec: settings.voiceIntervalSec,
    evaluatedAt: startedAt, accountedActiveMs: 0, lastEventCount: 0, status: 'UNKNOWN', candidate: 'UNKNOWN', consecutive: 0,
    currentPace: null, delta: null, validMs: 0, onTargetMs: 0, unknownMs: 0,
    unknownIntervals: [], omittedUnknownIntervals: 0, reached: false, lastVoiceAt: startedAt, lastGuidedStatus: 'UNKNOWN' };
}
/** Optional/corrupt add-on data is never a reason to reject a RunRecord. */
export function validPaceState(value: unknown): value is PaceWorkoutState {
  try {
    const s = value as PaceWorkoutState;
    return !!s && s.version === 1 && validWorkout(s.workout) && s.workout.segments.length === 1
      && typeof s.voice === 'boolean' && typeof s.reached === 'boolean'
      && finiteRange(s.voiceIntervalSec, 60, 600)
      && ['FAST', 'SLOW', 'ON_TARGET', 'UNKNOWN'].includes(s.status)
      && ['FAST', 'SLOW', 'ON_TARGET', 'UNKNOWN'].includes(s.candidate)
      && ['FAST', 'SLOW', 'ON_TARGET', 'UNKNOWN'].includes(s.lastGuidedStatus)
      && [s.evaluatedAt, s.accountedActiveMs, s.lastEventCount, s.consecutive, s.validMs, s.onTargetMs,
        s.unknownMs, s.omittedUnknownIntervals, s.lastVoiceAt].every(n => finiteRange(n, 0, Number.MAX_SAFE_INTEGER))
      && s.onTargetMs <= s.validMs
      && (s.currentPace === null || finiteRange(s.currentPace, 1, 100_000))
      && (s.delta === null || finiteRange(s.delta, -100_000, 100_000))
      && Array.isArray(s.unknownIntervals) && s.unknownIntervals.length <= 128
      && s.unknownIntervals.every(i => finiteRange(i.start, 0, Number.MAX_SAFE_INTEGER)
        && finiteRange(i.end, i.start, Number.MAX_SAFE_INTEGER) && ['WARMUP', 'GPS_QUALITY', 'STATIONARY', 'GAP'].includes(i.reason))
      && (!s.notice || typeof s.notice.key === 'string' && s.notice.key.length <= 100
        && typeof s.notice.message === 'string' && s.notice.message.length <= 200
        && Number.isFinite(s.notice.at) && typeof s.notice.goal === 'boolean');
  } catch { return false; }
}
export function safePaceMetadata(value: unknown): PaceWorkoutState | undefined {
  try {
    if (!validPaceState(value)) return undefined;
    const text = JSON.stringify(value);
    // Keep optional metadata bounded even for unexpected fields in imported data.
    if (text.length > 48 * 1024) return undefined;
    return JSON.parse(text);
  } catch { return undefined; }
}

/** Bounded 30s persisted-GPS window; no new correction or distance algorithm. */
export function windowPace(points: LocationPoint[], now: number, resumedAt: number) {
  const window: LocationPoint[] = [];
  for (let i = points.length - 1; i >= 0 && window.length < 64; i--) {
    const p = points[i];
    if (p.timestamp < now - 30_000 || p.timestamp < resumedAt) break;
    if (p.timestamp <= now) window.unshift(p);
  }
  if (now - resumedAt < 30_000 || window.length < 5 || now - (window.at(-1)?.timestamp ?? 0) > 10_000
    || (window.at(-1)!.timestamp - window[0].timestamp) < 25_000) return { pace: null, reason: 'WARMUP' as UnknownReason };
  if (!window.every(usableObservation)) return { pace: null, reason: 'GPS_QUALITY' as UnknownReason };
  if (window.slice(1).some((p, i) => p.timestamp <= window[i].timestamp || p.timestamp - window[i].timestamp > 10_000))
    return { pace: null, reason: 'GAP' as UnknownReason };
  const movement = inferMovement(window);
  if (!movement.moving) return { pace: null, reason: (movement.stationary || movement.summary.coherence < 0.7 ? 'STATIONARY' : 'GPS_QUALITY') as UnknownReason };
  // A mostly moving 30s window can still contain a stationary tail. Do not call
  // that diluted average a slow running pace while the formal stop is pending.
  if (!inferMovement(window.slice(-3)).moving) return { pace: null, reason: 'STATIONARY' as UnknownReason };
  const analysis = analyzePoints(window, window[0].timestamp, window.at(-1)!.timestamp);
  return { pace: analysis && analysis.distanceMeters >= 20 ? analysis.secondsPerKm : null, reason: 'GPS_QUALITY' as UnknownReason };
}

/** Pure add-on: callers always catch failures and retain the core GPS record. */
export function advancePaceWorkout(run: ActiveRun, now: number, force = false, sessionStartedAt = 0): ActiveRun {
  const old = run.paceWorkout;
  if (!validPaceState(old) || !Number.isFinite(now) || now < old.evaluatedAt) return run;
  const changed = (run.events?.length ?? 0) !== old.lastEventCount;
  if (!force && !changed && now - old.evaluatedAt < 30_000) return run;
  const s: PaceWorkoutState = { ...old, unknownIntervals: old.unknownIntervals.map(i => ({ ...i })), notice: undefined };
  const segment = s.workout.segments[0];
  const activeMs = timeModel(run, now).activeRunningTime;
  const deltaMs = Math.max(0, activeMs - s.accountedActiveMs);
  const paused = stateOf(run) !== 'RUNNING';
  const lastEvent = run.events?.at(-1);
  const resumedAt = Math.max(sessionStartedAt, Date.parse(run.startedAt), lastEvent?.confirmedAt ?? lastEvent?.timestamp ?? 0);
  const sample = windowPace(run.points, now, resumedAt);
  // Do not ascribe a delayed callback's entire gap or a stop-crossing interval to its last window.
  const uncertain = paused || changed || now - old.evaluatedAt > 40_000 || sample.pace === null;
  s.currentPace = uncertain ? null : sample.pace;
  s.delta = s.currentPace === null ? null : s.currentPace - segment.targetPaceSecPerKm;
  const raw = classifyPace(s.currentPace, segment);
  if (raw === 'UNKNOWN') { s.status = 'UNKNOWN'; s.candidate = 'UNKNOWN'; s.consecutive = 0; }
  else {
    s.consecutive = s.candidate === raw ? s.consecutive + 1 : 1; s.candidate = raw;
    s.status = s.consecutive >= 2 ? raw : 'UNKNOWN';
  }
  if (raw !== 'UNKNOWN') { s.validMs += deltaMs; if (raw === 'ON_TARGET') s.onTargetMs += deltaMs; }
  else if (deltaMs > 0) {
    s.unknownMs += deltaMs;
    const reason = changed ? 'WARMUP' : now - old.evaluatedAt > 40_000 ? 'GAP' : sample.reason;
    const interval = { start: old.evaluatedAt, end: now, reason };
    const previous = s.unknownIntervals.at(-1);
    if (previous?.reason === reason && previous.end === interval.start) previous.end = now;
    else if (s.unknownIntervals.length < 128) s.unknownIntervals.push(interval);
    else s.omittedUnknownIntervals++;
  }
  const reached = !s.reached && segmentReached(segment, run.distanceMeters, activeMs / 1000);
  s.reached ||= reached;
  if (s.voice && !paused && (reached || s.status !== 'UNKNOWN' && now - s.lastVoiceAt >= s.voiceIntervalSec * 1000
    && (s.status !== 'ON_TARGET' || s.lastGuidedStatus === 'FAST' || s.lastGuidedStatus === 'SLOW'))) {
    const message = reached ? 'ペース走の目標に到達しました。記録は継続します。'
      : s.status === 'ON_TARGET' ? '目標ペースに戻りました。'
        : savingsMessage(savingsSeconds(run.distanceMeters, activeMs, segment.targetPaceSecPerKm));
    s.notice = { key: `${run.id}:${now}`, message, at: now, goal: reached }; s.lastVoiceAt = now;
    if (!reached) s.lastGuidedStatus = s.status;
  }
  s.evaluatedAt = now; s.accountedActiveMs = activeMs; s.lastEventCount = run.events?.length ?? 0;
  return { ...run, paceWorkout: s };
}
let session: { id: string; startedAt: number } | undefined;
export function safelyAdvancePaceWorkout(run: ActiveRun, now: number, force = false): ActiveRun {
  try {
    if (!run.paceWorkout) return run;
    if (session?.id !== run.id) session = { id: run.id, startedAt: now };
    return advancePaceWorkout(run, now, force, session.startedAt);
  }
  catch (error) { console.warn('Pace workout skipped; GPS record retained', error); return run; }
}
export function formatWorkoutPace(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
