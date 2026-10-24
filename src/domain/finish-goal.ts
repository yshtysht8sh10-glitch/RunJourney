import type { ActiveRun, RunRecord } from '../types/run';
import { effectiveEdges, timeModel } from '../utils/run-model';
import { activeBoundaryWallTime } from './voice-guidance';

export type FinishGoal = { kind: 'manual' } | { kind: 'distance'; meters: number } | { kind: 'time'; activeMs: number };
export type GoalAchievement = { goal: Exclude<FinishGoal, { kind: 'manual' }>; reachedAt: number; detectedAt: number; distanceMeters: number; activeMs: number };
export function validFinishGoal(value: unknown): value is FinishGoal {
  if (!value || typeof value !== 'object') return false;
  const g = value as FinishGoal;
  return g.kind === 'manual' || g.kind === 'distance' && Number.isFinite(g.meters) && g.meters >= 100 && g.meters <= 200000
    || g.kind === 'time' && Number.isFinite(g.activeMs) && g.activeMs >= 60000 && g.activeMs <= 172800000;
}
/** Only accepted effective edges contribute; raw fixes remain untouched. */
export function goalAchievement(run: ActiveRun, now: number): GoalAchievement | null {
  const goal = run.finishGoal;
  if (!validFinishGoal(goal) || goal.kind === 'manual' || run.endedAt) return null;
  let activeMs: number;
  if (goal.kind === 'time') {
    if (timeModel(run, now).activeRunningTime < goal.activeMs) return null;
    activeMs = goal.activeMs;
  } else {
    let distance = 0;
    let boundary: number | undefined;
    for (const edge of effectiveEdges(run, now)) {
      if (distance + edge.distanceMeters >= goal.meters) {
        boundary = edge.startMs + (edge.endMs - edge.startMs) * (goal.meters - distance) / edge.distanceMeters;
        break;
      }
      distance += edge.distanceMeters;
    }
    if (boundary === undefined) return null;
    activeMs = boundary;
  }
  // ISO dates have millisecond precision. Round once, consistently for all models.
  let reachedAt = Math.round(activeBoundaryWallTime(run, activeMs, now));
  let clipped = { ...run, endedAt: new Date(reachedAt).toISOString() };
  // Rounding down must not hide the final kilometer from history lap analysis.
  // Take the first representable millisecond that has actually reached the goal.
  if (goal.kind === 'distance' && effectiveEdges(clipped).reduce((s, e) => s + e.distanceMeters, 0) < goal.meters) {
    reachedAt += 1; clipped = { ...run, endedAt: new Date(reachedAt).toISOString() };
  }
  return { goal, reachedAt, detectedAt: now, activeMs: timeModel(clipped).activeRunningTime,
    distanceMeters: effectiveEdges(clipped).reduce((sum, edge) => sum + edge.distanceMeters, 0) };
}
export function achievementMessage(run: Pick<RunRecord, 'achievement'>) {
  const g = run.achievement?.goal;
  return g ? `目標の${g.kind === 'distance' ? `${g.meters / 1000}キロメートル` : `${g.activeMs / 60000}分`}に到達しました。計測を終了しました。お疲れさまでした。` : '';
}
