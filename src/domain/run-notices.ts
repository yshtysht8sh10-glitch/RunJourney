import type { ActiveRun } from '../types/run';
import type { ClockSettings } from '../repositories/clock-settings';
import { effectiveDistance, timeModel } from '../utils/run-model';
export type GoalWarningSettings = { distanceMeters: number; timeSeconds: number };
export const DEFAULT_GOAL_WARNING: GoalWarningSettings = { distanceMeters: 500, timeSeconds: 60 };
export function validGoalWarning(v: GoalWarningSettings) {
  return Number.isFinite(v.distanceMeters) && v.distanceMeters >= 50 && v.distanceMeters <= 5000 &&
    Number.isFinite(v.timeSeconds) && v.timeSeconds >= 10 && v.timeSeconds <= 600;
}
export function goalRevision(run: ActiveRun) {
  const g=run.finishGoal;
  return JSON.stringify([g?.kind ?? 'manual',g?.kind==='distance'?g.meters:g?.kind==='time'?g.activeMs:null,run.finishAutoEnabled!==false]);
}
export function startMessage(run: ActiveRun, clock: ClockSettings) {
  const g = run.finishGoal;
  const goal = !g || g.kind === 'manual' ? '手動終了、目標指定なし、自動終了OFF' :
    `目標${g.kind === 'distance' ? `${g.meters / 1000}キロメートル` : `${g.activeMs / 60000}分`}、自動終了${run.finishAutoEnabled === false ? 'OFF' : 'ON'}`;
  return `RUNを開始しました。${goal}、Auto Stop ${run.features?.autoStop ? 'ON' : 'OFF'}。現在時刻案内は${clock.enabled ? `${clock.minutes}分ごとです。` : 'OFFです。'}`;
}
export function goalWarning(run: ActiveRun, settings: GoalWarningSettings, now: number) {
  const g = run.finishGoal;
  if (run.endedAt || !g || g.kind === 'manual' || run.finishAutoEnabled === false) return { reason: 'DISABLED_OR_ENDED' };
  if (!validGoalWarning(settings)) return { reason: 'INVALID_CONFIGURATION' };
  const remaining = g.kind === 'distance' ? g.meters - effectiveDistance(run) : (g.activeMs - timeModel(run, now).activeRunningTime) / 1000;
  const threshold = g.kind === 'distance' ? settings.distanceMeters : settings.timeSeconds;
  if (remaining <= 0) return { reason: 'GOAL_ALREADY_REACHED' };
  if (remaining > threshold) return { reason: 'BEFORE_WARNING_THRESHOLD' };
  const amount = g.kind === 'distance' ? `${Math.ceil(remaining)}メートル` : `${Math.ceil(remaining)}秒`;
  return { reason: 'DUE', revision: goalRevision(run), remaining, threshold,
    message: `目標まで残り${amount}です。延長する場合は目標を変更してください。` };
}
