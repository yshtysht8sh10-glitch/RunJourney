import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PaceWorkoutState, formatWorkoutPace, validPaceState } from '../domain/pace-workout';
import { iteratePages } from '../domain/pages';
import { pagedDistanceLaps } from '../domain/paged-analysis';
import { RunRepository } from '../repositories/run-repository';
import { analyzePace } from '../utils/pace-analysis';
import { achievementMessage } from '../domain/finish-goal';

export default function PaceWorkoutReport({ runId, lazy = false }: { runId: string; lazy?: boolean }) {
  const [requested, setRequested] = useState(!lazy);
  const [state, setState] = useState<PaceWorkoutState | null>(null);
  const [average, setAverage] = useState<number | null>(null);
  const [laps, setLaps] = useState<Awaited<ReturnType<typeof pagedDistanceLaps>>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [achievement, setAchievement] = useState('');
  useEffect(() => {
    let mounted = true;
    if (!requested) return;
    (async () => {
      const source = RunRepository.pagedSource(runId);
      let text = '';
      for await (const page of iteratePages(source, 'metadata')) {
        text += page.items.join('');
        if (text.length > 128 * 1024) return;
      }
      const metadata = text ? JSON.parse(text) : {};
      if (mounted) setAchievement(achievementMessage(metadata));
      if (!validPaceState(metadata.paceWorkout)) return;
      const summary = await source.summary();
      if (mounted) {
        setState(metadata.paceWorkout);
        setAverage(analyzePace(0, summary.activeRunningTime, summary.distanceMeters).secondsPerKm);
      }
    })().catch(() => { if (mounted) setError('ペース走の追加分析を読み込めませんでした。走行記録は保持されています。'); });
    return () => { mounted = false; };
  }, [runId, requested]);
  if (!requested) return <Pressable accessibilityRole="button" style={styles.button} onPress={() => setRequested(true)}><Text style={styles.text}>ペース走の結果を確認</Text></Pressable>;
  if (!state) return <>{!!achievement && <Text accessibilityRole="alert" style={styles.text}>{achievement}</Text>}{!!error && <Text style={styles.note}>{error}</Text>}</>;
  const segment = state.workout.segments[0];
  const difference = average === null ? null : Math.round(average - segment.targetPaceSecPerKm);
  return <View style={styles.panel} testID="pace-workout-report">
    {!!achievement && <Text accessibilityRole="alert" style={styles.text}>{achievement}</Text>}
    <Text style={styles.title}>ペース走の結果</Text>
    <Text style={styles.text}>目標 {formatWorkoutPace(segment.targetPaceSecPerKm)} /km（±{segment.toleranceSecPerKm}秒）</Text>
    <Text style={styles.text}>平均 {formatWorkoutPace(average)} /km · 目標との差 {difference === null ? '—' : `${difference >= 0 ? '+' : ''}${difference}秒/km`}</Text>
    <Text style={styles.text}>目標範囲内 {state.validMs > 0 ? `${(state.onTargetMs / state.validMs * 100).toFixed(1)}%` : '評価区間なし'}</Text>
    <Text style={styles.note}>範囲内の評価時間 {Math.round(state.onTargetMs / 1000)}秒 ÷ GPS品質と移動を確認できた評価時間 {Math.round(state.validMs / 1000)}秒。移動窓による推定値です。停止・休憩の時間は除外します。</Text>
    <Text style={styles.note}>判定保留 {Math.round(state.unknownMs / 1000)}秒（GPS品質・観測不足・停止付近・再開直後）。保留時間は割合の分母・分子から除外。割合は走行中の記録で、後からの停止補正を反映しません。</Text>
    {state.reached && <Text style={styles.text}>目標到達を記録しました</Text>}
    {state.unknownIntervals.length > 0 && <Text style={styles.note}>判定できなかった区間：{state.unknownIntervals.map(i => `${new Date(i.start).toLocaleTimeString('ja-JP')}〜${new Date(i.end).toLocaleTimeString('ja-JP')} (${i.reason})`).join('、')}{state.omittedUnknownIntervals ? ` ／ほか${state.omittedUnknownIntervals}区間（合計時間には含む）` : ''}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={async () => {
      setBusy(true); setError('');
      try { setLaps(await pagedDistanceLaps(RunRepository.pagedSource(runId))); }
      catch (e) { setError(`1kmラップの解析を保留しました: ${String(e)}`); }
      finally { setBusy(false); }
    }}><Text style={styles.text}>{busy ? '解析中…' : '1kmラップを表示'}</Text></Pressable>
    {laps.map((lap, i) => <Text key={i} style={styles.text}>{i + 1}：{(lap.distanceMeters / 1000).toFixed(2)}km · {formatWorkoutPace(lap.secondsPerKm)} /km</Text>)}
    {!!error && <Text style={styles.note}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({ panel: { paddingVertical: 18, gap: 10 }, title: { color: '#A8D4B1', fontSize: 20, fontWeight: '700' },
  text: { color: '#F5F2EB', fontSize: 16, lineHeight: 24 }, note: { color: '#A6A7A9', fontSize: 13, lineHeight: 21 },
  button: { backgroundColor: '#33424C', borderRadius: 8, padding: 14, minHeight: 48 } });
