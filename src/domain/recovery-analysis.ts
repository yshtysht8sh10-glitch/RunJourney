import type { RunHistoryItem, RunRecord } from '../types/run';
import { effectiveRun } from '../utils/run-model';

const day = (value: string) => { const d = new Date(value); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };
/** Experimental local observations; does not modify records or diagnose fatigue. */
export function recoveryAnalysis(history: RunHistoryItem[], run: RunRecord, completeHistory: boolean) {
  const anchor = day(run.startedAt);
  const rows = history.filter(r => Number.isFinite(day(r.startedAt)) && day(r.startedAt) <= anchor && Date.parse(r.startedAt) <= Date.parse(run.startedAt));
  const activeDays = new Set(rows.map(r => day(r.startedAt)));
  let consecutiveDays = 0;
  while (activeDays.has(anchor - consecutiveDays)) consecutiveDays++;
  const windows = [4, 7, 14, 28].map(days => {
    const selected = rows.filter(r => day(r.startedAt) > anchor - days);
    return { days, distanceKm: selected.reduce((n, r) => n + r.distanceMeters, 0) / 1000,
      activeMinutes: selected.reduce((n, r) => n + r.activeRunningTime, 0) / 60000,
      recordedRunDays: new Set(selected.map(r => day(r.startedAt))).size,
      noRecordedRunDays: completeHistory ? days - new Set(selected.map(r => day(r.startedAt))).size : null };
  });
  const effective = effectiveRun(run), half = effective.activeRunningTime / 2;
  const first = effective.lap(0, half), second = effective.lap(half, half * 2);
  const slowdown = first.secondsPerKm && second.secondsPerKm ? (second.secondsPerKm / first.secondsPerKm - 1) * 100 : null;
  const poorGps = run.points.filter(p => !Number.isFinite(p.accuracy) || p.accuracy! > 20).length;
  const confounded = !completeHistory || run.points.length < 30 || half < 600000 ||
    first.distanceMeters < 1000 || second.distanceMeters < 1000 || poorGps > run.points.length * .1 ||
    !!run.goalChanges?.length || (run.paceWorkout?.workout.segments.length ?? 0) > 1 || effective.intervals.length > 0;
  const prior = rows.filter(r => r.id !== run.id && day(r.startedAt) > anchor - 28 && r.distanceMeters >= 1000);
  const priorPaces = prior.map(r => r.activeRunningTime / r.distanceMeters).sort((a, b) => a - b);
  const priorMedianSecPerKm = priorPaces.length >= 3 ? priorPaces[Math.floor(priorPaces.length / 2)] : null;
  return { schema: 1, anchorDate: run.startedAt, windows, consecutiveRecordedDays: consecutiveDays,
    firstHalfSecPerKm: first.secondsPerKm, secondHalfSecPerKm: second.secondsPerKm, slowdownPercent: slowdown,
    priorRuns: prior.length, priorMedianSecPerKm,
    quality: { completeHistory, gpsPoints: run.points.length, poorOrMissingAccuracyPoints: poorGps,
      stopIntervals: effective.intervals.length, goalChanges: run.goalChanges?.length ?? 0,
      plannedSegments: run.paceWorkout?.workout.segments.length ?? 0, confounded },
    inference: !confounded && slowdown !== null && slowdown >= 10 && consecutiveDays >= 3 && prior.length >= 3
      ? '連日の走行と後半のペース低下が重なっています。疲労蓄積の可能性はありますが、意図的な減速・坂・天候などを区別できません。休養や負荷を軽くすることを検討してください。'
      : 'データ不足または停止・GPS品質・目標変更などの影響を分離できないため、疲労の推定は控えます。',
    limitations: '記録のない日は休養を確認した日ではありません。前後半は停止除外後の実走時間で二分。過去平均との差はコースや強度を揃えた比較ではありません。医療診断・怪我予測は行いません。外部送信なし。' };
}
