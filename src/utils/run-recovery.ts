import { ActiveRun, RunRecord } from '@/types/run';
import { detectStop, effectiveRun, stopIntervals } from '@/utils/run-model';
import { MOVEMENT_ALGORITHM } from '@/utils/movement-inference';

/** Pure saved-GPS replay: never infer manual Break from physical motion. */
export function recoveryPreview(original: RunRecord) {
  if (original.points.length < 3) throw new Error('再解析に必要なGPSが不足しています');
  if (original.stopOverrides && Object.keys(original.stopOverrides).length)
    throw new Error('停止区間の手動訂正があります。訂正を保持するため、この記録の自動復元は現在利用できません');
  let replay: ActiveRun = { ...original, endedAt: undefined, recovery: undefined, points: [], events: [], detector: undefined,
    stopOverrides: undefined, features: { autoStop: true, break: true }, diagnostics: { entries: [], counts: {}, processed: 0 } };
  const manual = (original.events ?? []).filter(e => e.source === 'user').sort((a, b) => a.timestamp - b.timestamp);
  let cursor = 0;
  for (const point of [...original.points].sort((a, b) => a.timestamp - b.timestamp)) {
    while (cursor < manual.length && manual[cursor].timestamp <= point.timestamp) {
      replay = { ...replay, events: [...(replay.events ?? []), manual[cursor++]], detector: undefined };
    }
    replay = detectStop(replay, point, 'replay');
  }
  replay.events = [...(replay.events ?? []), ...manual.slice(cursor)];
  const operation = { algorithm: MOVEMENT_ALGORITHM, appliedAt: new Date().toISOString(), events: replay.events };
  const candidate: RunRecord = { ...original, recovery: operation };
  const current = effectiveRun(original), proposed = effectiveRun(candidate);
  const restored = stopIntervals({ ...original, recovery: undefined }).filter(i => i.kind === 'AUTO_STOP' && !i.included)
    .map(i => effectiveRun({ ...candidate, startedAt: new Date(i.startMs).toISOString(), endedAt: new Date(i.endMs).toISOString() }));
  const gaps = original.points.slice(1).filter((p, i) => p.timestamp - original.points[i].timestamp > 15000).length;
  return { current, proposed, operation, transitions: replay.events,
    restoredDistanceMeters: restored.reduce((sum, v) => sum + v.distanceMeters, 0),
    restoredTimeMs: restored.reduce((sum, v) => sum + v.activeRunningTime, 0),
    warnings: [`保存GPS ${original.points.length}点による推定です。観測間の動きは確定できません。`, ...(gaps ? [`15秒超のGPS欠測が${gaps}区間あります。`] : [])],
  };
}

export function applyRecovery(original: RunRecord): RunRecord {
  return { ...original, recovery: recoveryPreview(original).operation };
}
export function undoRecovery(run: RunRecord): RunRecord {
  const { recovery: _recovery, ...original } = run;
  return original;
}
