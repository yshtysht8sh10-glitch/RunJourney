import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { effectiveRun } from '@/utils/run-model';

export default function RunSummary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(useCallback(() => {
    let mounted = true;
    setRun(null); setError('');
    RunRepository.getRuns().then(runs => {
      if (!mounted) return;
      const saved = runs.find(record => record.id === id) ?? null;
      setRun(saved); setError(saved ? '' : '記録を確認できませんでした。履歴を確認してください。');
    }).catch(() => mounted && setError('記録を読み込めませんでした。'));
    return () => { mounted = false; };
  // A retry deliberately re-runs the focused read, even when the ID is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt]));
  const effective = run ? effectiveRun(run) : null;
  const seconds = effective?.pace.secondsPerKm;
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>本日のRUN完了！</Text>
    {run && effective ? <>
      <Text style={styles.label}>総走行距離</Text>
      <Text testID="summary-distance" style={styles.distance}>{(effective.distanceMeters / 1000).toFixed(2)} km</Text>
      <Text style={styles.label}>実走時間</Text>
      <Text testID="summary-time" style={styles.time}>{Math.floor(effective.activeRunningTime / 60000)}分{String(Math.floor(effective.activeRunningTime / 1000) % 60).padStart(2, '0')}秒</Text>
      <Text testID="summary-pace" style={styles.text}>平均ペース：{seconds == null ? '—' : `${Math.floor(Math.round(seconds) / 60)}分${String(Math.round(seconds) % 60).padStart(2, '0')}秒/km`}</Text>
      <Text testID="summary-speed" style={styles.text}>平均速度：{effective.pace.kmPerHour?.toFixed(2) ?? '—'} km/h</Text>
      <Text style={styles.label}>開始：{new Date(run.startedAt).toLocaleString('ja-JP')}</Text>
      <Text style={styles.label}>終了：{new Date(run.endedAt).toLocaleString('ja-JP')}</Text>
      <Text testID="summary-saved" style={styles.saved}>履歴に保存しました</Text>
    </> : <>
      <Text accessibilityRole={error ? 'alert' : undefined} style={styles.text}>{error || '保存した記録を読み込み中…'}</Text>
      {!!error && <Pressable testID="summary-retry" accessibilityRole="button" style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text style={styles.text}>再読み込み</Text></Pressable>}
    </>}
    <Pressable testID="summary-history" accessibilityRole="button" style={styles.button} onPress={() => router.replace('/history')}><Text style={styles.buttonText}>履歴を見る</Text></Pressable>
    <Pressable testID="summary-home" accessibilityRole="button" style={styles.button} onPress={() => router.replace('/')}><Text style={styles.buttonText}>ホームへ</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111418' },
  content: { padding: 24, paddingBottom: 48, flexGrow: 1 },
  title: { color: '#F5F2EB', fontSize: 28, fontWeight: '800', marginVertical: 24 },
  label: { color: '#A6A7A9', fontSize: 15, lineHeight: 25, marginTop: 14 },
  distance: { color: '#E85D2A', fontSize: 48, fontWeight: '800', marginVertical: 8 },
  time: { color: '#F5F2EB', fontSize: 32, fontWeight: '700', marginBottom: 24 },
  text: { color: '#F5F2EB', fontSize: 17, lineHeight: 28 },
  saved: { color: '#A8D4B1', fontSize: 18, fontWeight: '700', marginVertical: 28 },
  button: { minHeight: 56, justifyContent: 'center', alignItems: 'center', backgroundColor: '#33424C', borderRadius: 14, padding: 14, marginTop: 12 },
  buttonText: { color: '#F5F2EB', fontSize: 18, fontWeight: '700' },
});
