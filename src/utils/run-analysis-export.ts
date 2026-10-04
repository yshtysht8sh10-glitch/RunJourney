import { RunRecord } from '@/types/run';
import { effectiveRun, RUN_CONTROL } from '@/utils/run-model';
import { MARATHON_METERS } from '@/utils/pace-analysis';

const numeric = (value: number | null | undefined, digits = 2) => value != null && Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
const duration = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return 'N/A';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 3600)}:${String(Math.floor(rounded / 60) % 60).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};
const safeText = (value: string) => value.replace(/[\r\n|<>]/g, ' ');
export function serializeAnalysis(run: RunRecord, generatedAt = Date.now()): string {
  if (run.trashedAt !== undefined) throw new Error('ごみ箱の記録は分析Export対象外です');
  const effective = effectiveRun(run);
  const accuracies = run.points.map(p => p.accuracy).filter((v): v is number => v !== undefined && Number.isFinite(v) && v >= 0);
  const intervals = run.points.slice(1).map((p, i) => p.timestamp - run.points[i].timestamp).filter(v => Number.isFinite(v) && v >= 0);
  const average = (values: number[]) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  return [
    '# RunJourney Analysis Export', '', 'Format: runjourney-analysis / version 1', `Generated at: ${new Date(generatedAt).toISOString()}`, '',
    '正確な緯度経度は含みません。走行日時・ID・活動情報を含むため共有先を確認してください。', '',
    '## Run', `ID: ${safeText(run.id)}`, `Start: ${safeText(run.startedAt)}`, `End: ${safeText(run.endedAt)}`,
    `Wall time: ${duration(effective.wallClockElapsed / 1000)}`, `Active time: ${duration(effective.activeRunningTime / 1000)}`,
    `Distance: ${numeric(effective.distanceMeters / 1000)} km`, `Average pace: ${numeric(effective.pace.secondsPerKm)} seconds/km`,
    `Average speed: ${numeric(effective.pace.kmPerHour)} km/h`, `Marathon equivalent: ${duration(effective.pace.projectedTimeSeconds(MARATHON_METERS))}`, '',
    '## 5-minute active-time laps', '| Lap | Active range (s) | Duration (s) | Distance (km) | Pace (s/km) | Speed (km/h) | Marathon |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...effective.laps().map((lap, i) => `| ${i + 1} | ${numeric(lap.startMs / 1000, 0)}–${numeric(lap.endMs / 1000, 0)} | ${numeric(lap.durationMs / 1000, 0)} | ${numeric(lap.distanceMeters / 1000)} | ${numeric(lap.secondsPerKm)} | ${numeric(lap.kmPerHour)} | ${duration(lap.projectedTimeSeconds(MARATHON_METERS))} |`), '',
    '## Stops / inclusion overrides', '| Kind | Start (UTC) | End (UTC) | Duration (s) | Included in running |', '| --- | --- | --- | --- | --- |',
    ...effective.intervals.map(i => `| ${i.kind} | ${new Date(i.startMs).toISOString()} | ${new Date(i.endMs).toISOString()} | ${numeric(i.durationMs / 1000)} | ${i.included ? 'yes (override)' : 'no'} |`),
    `Excluded Auto Stop: ${numeric(effective.autoStoppedDuration / 1000)} s`, `Excluded Break: ${numeric(effective.breakDuration / 1000)} s`, '',
    '## GPS quality / diagnostics', `Persisted GPS point count: ${run.points.length}`, 'Raw observation count: N/A (not separately persisted)',
    `Average accuracy: ${numeric(average(accuracies))} m`, `Maximum accuracy: ${numeric(accuracies.length ? accuracies.reduce((a, b) => Math.max(a, b)) : null)} m`,
    `Poor accuracy count (> ${RUN_CONTROL.accuracy} m): ${accuracies.filter(v => v > RUN_CONTROL.accuracy).length}`,
    `Unknown accuracy count: ${run.points.length - accuracies.length}`, `Average persisted GPS interval: ${numeric(average(intervals))} ms`,
    `Detector version: ${run.detector?.version ?? 'N/A (legacy)'}`, `Diagnostic processed count: ${run.diagnostics?.processed ?? 'N/A'}`,
    ...Object.entries(run.diagnostics?.counts ?? {}).map(([key, count]) => `${safeText(key)}: ${numeric(count, 0)}`), '',
    '## Notes', 'Derived from the same Effective Run / Pace Analysis as History and Voice. Final short lap is included. This analysis file cannot be imported as a backup.', '',
  ].join('\n');
}
