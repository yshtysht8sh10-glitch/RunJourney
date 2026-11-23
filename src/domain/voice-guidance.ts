import { ActiveRun, LocationPoint } from '../types/run';
import { effectiveEdges, stateOf, timeModel } from '../utils/run-model';
import { distanceBetween } from '../utils/distance';
import { usableObservation } from '../utils/movement-inference';
import { lapDistanceSpeech } from '../utils/voice-format';

export const savingsSeconds = (meters: number, activeMs: number, target: number) => target * meters / 1000 - activeMs / 1000;
export function spokenDuration(seconds: number) {
  const n = Math.round(Math.abs(seconds));
  return `${n >= 60 ? `${Math.floor(n / 60)}分` : ''}${n % 60 || n < 60 ? `${n % 60}秒` : ''}`;
}
export function savingsMessage(seconds: number) {
  return seconds < -0.5 ? `目標より${spokenDuration(seconds)}遅れています。`
    : seconds >= 0.5 ? `目標より${spokenDuration(seconds)}早いです。` : '累計の貯金と遅れはありません。';
}
/** Interpolate distance boundaries on the existing effective active-time edges. */
type BoundaryEdge = { startMs: number; endMs: number; distanceMeters: number; startDistanceMeters: number };
export function targetDurationAtDistance(run: ActiveRun, meters: number): number | null {
  const segments=run.paceWorkout?.workout.segments;
  if(!segments?.length || !Number.isFinite(meters) || meters<0)return null;
  let remaining=meters,seconds=0;
  for(const [i,s] of segments.entries()) {
    const pace=s.targetPaceSecPerKm;
    const length=s.target.type==='distance'?s.target.meters:s.target.seconds/pace*1000;
    if(!Number.isFinite(pace)||pace<=0||!Number.isFinite(length)||length<=0)return null;
    const part=i===segments.length-1?remaining:Math.min(remaining,length);
    seconds+=part/1000*pace;remaining-=part;
    if(remaining<=0)return seconds;
  }
  return null;
}
export function lapDifferenceMessage(lap: number, total: number) {
  const text=(n:number,lap:boolean)=>Math.round(Math.abs(n))===0 ? (lap?'今回のラップは目標どおりでした。':'合計では目標どおりです。')
    : `${lap?'今回のラップは':'合計では'}目標より${spokenDuration(n)}${n>0?(lap?'早かったです。':'早いです。'):(lap?'遅かったです。':'遅いです。')}`;
  return text(lap,true)+text(total,false);
}
export function kilometerLaps(run: ActiveRun, now: number) {
  const result: { km: number; activeMs: number; lapMs: number; targetLapSeconds: number | null; targetCumulativeSeconds: number | null; startActiveMs: number; startBoundary: BoundaryEdge | null; endBoundary: BoundaryEdge; lapSavings: number | null; cumulativeSavings: number | null; message: string }[] = [];
  let distance = 0, previousMs = 0, nextKm = 1;
  let previousBoundary: BoundaryEdge | null = null;
  for (const edge of effectiveEdges(run, now)) {
    while (distance + edge.distanceMeters >= nextKm * 1000 && result.length < 200) {
      const activeMs = edge.startMs + (edge.endMs - edge.startMs) * (nextKm * 1000 - distance) / edge.distanceMeters;
      const lapMs = activeMs - previousMs;
      const targetCumulativeSeconds=targetDurationAtDistance(run,nextKm*1000);
      const previousTarget=targetDurationAtDistance(run,(nextKm-1)*1000);
      const targetLapSeconds=targetCumulativeSeconds===null||previousTarget===null?null:targetCumulativeSeconds-previousTarget;
      const lapSavings = targetLapSeconds===null?null:targetLapSeconds-lapMs/1000;
      const cumulativeSavings = targetCumulativeSeconds===null?null:targetCumulativeSeconds-activeMs/1000;
      const endBoundary = { ...edge, startDistanceMeters: distance };
      result.push({ km: nextKm, activeMs, lapMs, targetLapSeconds,targetCumulativeSeconds,startActiveMs: previousMs, startBoundary: previousBoundary, endBoundary, lapSavings, cumulativeSavings,
        message: `${nextKm}キロを通過しました。${lapSavings!==null&&cumulativeSavings!==null?lapDifferenceMessage(lapSavings,cumulativeSavings):`今回のラップは${spokenDuration(lapMs/1000)}。`}` });
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
  // Use the consecutive stationary suffix. Including a moving fix from four
  // seconds ago needlessly postpones a valid two-second hint until it ages out.
  const recent = points.filter(p => last && p.timestamp >= last.timestamp - 4000).slice(-6);
  let start = recent.length;
  while (start > 0) {
    const p = recent[start - 1];
    if (!usableObservation(p) || p.accuracy! > 12 || p.speed === undefined || p.speed < 0 || p.speed > 0.35) break;
    start--;
  }
  const window = recent.slice(start);
  const age = last ? now - last.timestamp : Infinity;
  return age >= 0 && age <= 3000 && window.length >= 3
    && window.at(-1)!.timestamp - window[0].timestamp >= 2000
    && window.every((p, i) => usableObservation(p) && p.accuracy! <= 12 && p.speed !== undefined && p.speed >= 0 && p.speed <= 0.35
      && (i === 0 || p.timestamp > window[i - 1].timestamp && p.timestamp - window[i - 1].timestamp <= 2000))
    && window.every(p => window.every(q => distanceBetween(p, q) <= 2));
}

/** A recovery describes its new sampling time, never a stale rolling pace. */
export function recoveryGuidance(run: ActiveRun, now: number) {
  const data = voiceSnapshot(run, now);
  const pace = data.distanceMeters >= 30 ? data.activeMs / data.distanceMeters : null;
  return { data, message: `保留していた走行情報です。実走行${spokenDuration(data.activeMs / 1000)}時点で、総走行距離${lapDistanceSpeech(data.distanceMeters)}。${pace === null ? '' : `ここまでの平均は1キロ${spokenDuration(pace)}ペースです。`}${data.cumulativeSavingsSec === null ? '' : savingsMessage(data.cumulativeSavingsSec)}` };
}
export function voiceSnapshot(run: ActiveRun, now: number) {
  const t = timeModel(run, now);
  const target = run.paceWorkout?.workout?.segments?.[0]?.targetPaceSecPerKm ?? null;
  const targetCumulativeSeconds=targetDurationAtDistance(run,run.distanceMeters);
  const currentPace = stateOf(run) === 'RUNNING' && now - (run.paceWorkout?.evaluatedAt ?? 0) <= 40000 ? run.paceWorkout?.currentPace ?? null : null;
  return { runId: run.id, sampledAt: now, candidateId: run.diagnostics?.entries.at(-1)?.pipeline?.candidateId ?? null, distanceMeters: run.distanceMeters,
    elapsedMs: t.wallClockElapsed, activeMs: t.activeRunningTime, stoppedMs: t.autoStoppedDuration + t.breakDuration,
    currentPaceSecPerKm: currentPace, targetPaceSecPerKm: target,
    targetCumulativeSeconds,
    cumulativeSavingsSec: targetCumulativeSeconds===null ? null : targetCumulativeSeconds-t.activeRunningTime/1000,
    marathonPredictionSec: run.distanceMeters > 0 ? t.activeRunningTime / 1000 / (run.distanceMeters / 1000) * 42.195 : null,
    state: stateOf(run), gps: run.diagnostics?.entries.at(-1) ?? null,
    formulas: { savings: 'targetCumulativeSeconds - activeMs / 1000', lapSavings: 'targetLapSeconds - lapMs / 1000',
      active: 'elapsedMs - autoStoppedDuration - breakDuration', currentPace: 'persisted GPS, rolling 30s after resume confirmation; quality-gated',
      marathon: 'all-run activeMs / 1000 / (distanceMeters / 1000) * 42.195', lap: 'effectiveEdges distance-boundary interpolation, active clock' },
    source: 'existing effectiveEdges/timeModel; current pace and marathon use different windows',
    unavailable: ['OS audible volume', 'listener hearing confirmation'] };
}

/** Earliest wall time at an effective boundary; plateaus never refresh old notices. */
export function activeBoundaryWallTime(run: ActiveRun, activeMs: number, now: number) {
  let lo = Date.parse(run.startedAt), hi = run.endedAt ? Date.parse(run.endedAt) : now;
  const active = { ...run, endedAt: undefined };
  for (let i = 0; i < 48 && hi - lo > 0.001; i++) {
    const mid = (lo + hi) / 2;
    if (timeModel(active, mid).activeRunningTime >= activeMs) hi = mid; else lo = mid;
  }
  return hi;
}
