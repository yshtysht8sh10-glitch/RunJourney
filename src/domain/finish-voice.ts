import type { RunRecord } from '../types/run';
import { runMetrics } from './review';
import { kilometerLaps, spokenDuration } from './voice-guidance';
import { lapDistanceSpeech } from '../utils/voice-format';

/** Same saved record / effective model as the history and completion screens. */
export function finishVoice(run: RunRecord) {
  const metrics = runMetrics(run);
  const laps = kilometerLaps(run, Date.parse(run.endedAt));
  const last = laps.at(-1);
  const valid = metrics.distanceMeters >= 30 && metrics.activeRunningTime > 0;
  const parts = [run.achievement ? '目標に到達し、走行を終了しました' : '走行を終了しました',
    `走行距離${lapDistanceSpeech(metrics.distanceMeters)}`, `実走時間${spokenDuration(Math.floor(metrics.activeRunningTime / 1000))}`];
  if (valid && metrics.pace.kmPerHour !== null && metrics.pace.secondsPerKm !== null) {
    const [whole, decimal] = metrics.pace.kmPerHour.toFixed(2).split('.');
    const digits = ['れい', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
    parts.push(`平均時速${whole}てん${decimal.split('').map(n => digits[Number(n)]).join('')}キロメートル`,
      `平均ペースは1キロ${spokenDuration(metrics.pace.secondsPerKm)}`);
  }
  if (last) parts.push(`1キロラップは${laps.length}本。最後の1キロは${spokenDuration(last.lapMs / 1000)}`);
  else if (valid) parts.push('1キロ未満のため、完了した1キロラップはありません');
  parts.push('お疲れさまでした');
  return { message: parts.join('。') + '。', data: { runId: run.id, savedEndedAt: run.endedAt,
    distanceMeters: metrics.distanceMeters, activeMs: metrics.activeRunningTime,
    averageSpeedKmh: valid ? metrics.pace.kmPerHour : null, averagePaceSecPerKm: valid ? metrics.pace.secondsPerKm : null,
    completedKilometerLaps: laps.length, lastKilometerLapMs: last?.lapMs ?? null,
    source: 'saved RunRecord / runMetrics / existing Pace Analysis; active time excludes auto stop and break' } };
}
