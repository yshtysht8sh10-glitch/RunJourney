import { ActiveRun, LocationPoint } from '../types/run';
import { effectiveEdges, stateOf, timeModel } from '../utils/run-model';
import { distanceBetween } from '../utils/distance';
import { usableObservation } from '../utils/movement-inference';

export const savingsSeconds = (meters: number, activeMs: number, target: number) => target * meters / 1000 - activeMs / 1000;
export function spokenDuration(seconds: number) {
  const n = Math.round(Math.abs(seconds));
  return `${n >= 60 ? `${Math.floor(n / 60)}分` : ''}${n % 60 || n < 60 ? `${n % 60}秒` : ''}`;
}
export function savingsMessage(seconds: number) {
  return seconds < -0.5 ? `累計で${spokenDuration(seconds)}遅れています。`
    : seconds >= 0.5 ? `累計貯金は${spokenDuration(seconds)}です。` : '累計の貯金と遅れはありません。';
}
/** Interpolate distance boundaries on the existing effective active-time edges. */
type BoundaryEdge = { startMs: number; endMs: number; distanceMeters: number; startDistanceMeters: number };
export function kilometerLaps(run: ActiveRun, now: number) {
  const result: { km: number; activeMs: number; lapMs: number; startActiveMs: number; startBoundary: BoundaryEdge | null; endBoundary: BoundaryEdge; lapSavings: number | null; cumulativeSavings: number | null; message: string }[] = [];
  const target = run.paceWorkout?.workout?.segments?.[0]?.targetPaceSecPerKm;
  let distance = 0, previousMs = 0, nextKm = 1;
  let previousBoundary: BoundaryEdge | null = null;
  for (const edge of effectiveEdges(run, now)) {
    while (distance + edge.distanceMeters >= nextKm * 1000 && result.length < 200) {
      const activeMs = edge.startMs + (edge.endMs - edge.startMs) * (nextKm * 1000 - distance) / edge.distanceMeters;
      const lapMs = activeMs - previousMs;
      const lapSavings = target === undefined ? null : savingsSeconds(1000, lapMs, target);
      const cumulativeSavings = target === undefined ? null : savingsSeconds(nextKm * 1000, activeMs, target);
      const change = lapSavings === null ? '' : Math.abs(lapSavings) < 0.5 ? '今回のラップの貯金増減はありません。'
        : `貯金が${spokenDuration(lapSavings)}${lapSavings > 0 ? '増えました' : '減りました'}。`;
      const endBoundary = { ...edge, startDistanceMeters: distance };
      result.push({ km: nextKm, activeMs, lapMs, startActiveMs: previousMs, startBoundary: previousBoundary, endBoundary, lapSavings, cumulativeSavings,
        message: `${nextKm}キロ通過。今回のラップは${spokenDuration(lapMs / 1000)}。${change}${cumulativeSavings === null ? '' : savingsMessage(cumulativeSavings)}` });
      previousBoundary = endBoundary; previousMs = activeMs; nextKm++;
    }
    distance += edge.distanceMeters;
  }
  return result;
}
/** Audio-only observation: 3 good fixes over 2–4s, tight spread AND low reported speed.
 * Never changes the detector, timer, distance or persisted run. Missing speed is unknown.
 */
export function stopHint(points: LocationPoint[], now: number) {
  const last = points.at(-1);
  const window = points.filter(p => last && p.timestamp >= last.timestamp - 4000).slice(-6);
  const age = last ? now - last.timestamp : Infinity;
  return age >= 0 && age <= 3000 && window.length >= 3
    && window.at(-1)!.timestamp - window[0].timestamp >= 2000
    && window.every((p, i) => usableObservation(p) && p.accuracy! <= 12 && p.speed !== undefined && p.speed >= 0 && p.speed <= 0.35
      && (i === 0 || p.timestamp > window[i - 1].timestamp && p.timestamp - window[i - 1].timestamp <= 2000))
    && window.every(p => window.every(q => distanceBetween(p, q) <= 2));
}
export function voiceSnapshot(run: ActiveRun, now: number) {
  const t = timeModel(run, now);
  const target = run.paceWorkout?.workout?.segments?.[0]?.targetPaceSecPerKm ?? null;
  const currentPace = stateOf(run) === 'RUNNING' && now - (run.paceWorkout?.evaluatedAt ?? 0) <= 40000 ? run.paceWorkout?.currentPace ?? null : null;
  return { runId: run.id, sampledAt: now, distanceMeters: run.distanceMeters,
    elapsedMs: t.wallClockElapsed, activeMs: t.activeRunningTime, stoppedMs: t.autoStoppedDuration + t.breakDuration,
    currentPaceSecPerKm: currentPace, targetPaceSecPerKm: target,
    cumulativeSavingsSec: target === null ? null : savingsSeconds(run.distanceMeters, t.activeRunningTime, target),
    marathonPredictionSec: run.distanceMeters > 0 ? t.activeRunningTime / 1000 / (run.distanceMeters / 1000) * 42.195 : null,
    state: stateOf(run), gps: run.diagnostics?.entries.at(-1) ?? null,
    formulas: { savings: 'targetSecPerKm * distanceMeters / 1000 - activeMs / 1000', lapSavings: 'targetSecPerKm - lapMs / 1000',
      active: 'elapsedMs - autoStoppedDuration - breakDuration', currentPace: 'persisted GPS, rolling 30s after resume confirmation; quality-gated',
      marathon: 'all-run activeMs / 1000 / (distanceMeters / 1000) * 42.195', lap: 'effectiveEdges distance-boundary interpolation, active clock' },
    source: 'existing effectiveEdges/timeModel; current pace and marathon use different windows',
    unavailable: ['OS audible volume', 'listener hearing confirmation'] };
}
