import { StyleSheet, Text, View } from 'react-native';
import { formatWorkoutPace, validPaceState } from '../domain/pace-workout';
import { ActiveRun } from '../types/run';
import { savingsSeconds, savingsMessage } from '../domain/voice-guidance';
import { stateOf, timeModel } from '../utils/run-model';
export function PaceWorkoutCard({ run, now }: { run: ActiveRun; now: number }) {
  const s = run.paceWorkout;
  if (!validPaceState(s)) return null;
  const segment = s.workout.segments[0];
  const known = stateOf(run) === 'RUNNING' && now - s.evaluatedAt <= 40_000 && !run.endedAt;
  const labels = { FAST: '速すぎる', SLOW: '遅め', ON_TARGET: '目標範囲内', UNKNOWN: '判定保留' };
  return <View testID="pace-workout-card" style={styles.card}>
    <Text style={styles.title}>PACE WORKOUT · {labels[known ? s.status : 'UNKNOWN']}</Text>
    <Text style={styles.text}>目標 {formatWorkoutPace(segment.targetPaceSecPerKm)} /km（±{segment.toleranceSecPerKm}秒）</Text>
    <Text style={styles.text}>現在 {formatWorkoutPace(known ? s.currentPace : null)} /km · 差 {known && s.delta !== null ? `${s.delta >= 0 ? '+' : ''}${Math.round(s.delta)}秒/km` : '—'}</Text>
    <Text style={styles.text}>{savingsMessage(savingsSeconds(run.distanceMeters, timeModel(run, now).activeRunningTime, segment.targetPaceSecPerKm))}</Text>
    <Text style={styles.text}>{segment.target.type === 'distance'
      ? `${(run.distanceMeters / 1000).toFixed(2)} / ${(segment.target.meters / 1000).toFixed(2)} km`
      : `目標 ${Math.round(segment.target.seconds / 60)}分`}{s.reached ? ' · 目標到達！記録は継続中' : ''}</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { alignSelf: 'stretch', padding: 14, borderRadius: 12, backgroundColor: '#25332F', gap: 7, marginBottom: 18 },
  title: { color: '#A8D4B1', fontSize: 14, fontWeight: '700' }, text: { color: '#F5F2EB', fontSize: 14, lineHeight: 21 } });
