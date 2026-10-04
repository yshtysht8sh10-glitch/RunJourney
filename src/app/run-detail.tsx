import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { effectiveRun } from '@/utils/run-model';
import { isStandaloneTest } from '@/utils/build';
import { exportAnalysis } from '@/services/run-export';

export default function RunDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let mounted = true;
    RunRepository.getRuns().then(runs => { if (mounted) { const found = runs.find(r => r.id === id) ?? null; setRun(found); setError(found ? '' : '記録が見つかりません'); } }).catch(() => mounted && setError('履歴を読み込めませんでした'));
    return () => { mounted = false; };
  }, [id]));
  const effective = run ? effectiveRun(run) : null;
  const change = async (intervalId: string, included: boolean) => {
    if (!run || busy) return;
    setBusy(true);
    try { setRun(await RunRepository.setStopInclusion(run.id, intervalId, included)); }
    catch (err) { Alert.alert('訂正を保存できませんでした', String(err)); }
    finally { setBusy(false); }
  };
  const trash = () => {
    if (!run || busy) return;
    Alert.alert('ごみ箱へ移動', 'この記録をごみ箱へ移動します。7日以内であれば復元できます。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'ごみ箱へ移動', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await RunRepository.moveToTrash(run.id); router.replace('/history'); }
        catch (err) { Alert.alert('ごみ箱へ移動できませんでした', String(err)); }
        finally { setBusy(false); }
      } },
    ]);
  };
  const duration = (ms: number) => `${Math.floor(ms / 60000)}分${Math.floor(ms / 1000) % 60}秒`;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString('ja-JP', { hour12: false });
  const pace = (seconds: number | null) => seconds ? `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')} /km` : '—';
  const laps = effective?.laps() ?? [];
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={() => router.replace('/history')} style={styles.button}><Text style={styles.text}>‹ 履歴に戻る</Text></Pressable>
    <Text style={styles.title}>走行詳細</Text>
    {!run || !effective ? <Text style={styles.text}>{error || '記録を読み込み中…'}</Text> : <>
      <Text style={styles.text}>{new Date(run.startedAt).toLocaleString('ja-JP')}</Text>
      <Text style={styles.metric}>{(effective.distanceMeters / 1000).toFixed(2)} km · {pace(effective.pace.secondsPerKm)}</Text>
      <Text style={styles.text}>実走 {duration(effective.activeRunningTime)} / 全経過 {duration(effective.wallClockElapsed)}</Text>
      <Text style={styles.note}>Analysis Exportには正確な緯度経度は含まれません。走行日時・活動情報は含まれます。</Text>
      <Pressable testID="analysis-export" accessibilityRole="button" disabled={busy} style={styles.button} onPress={async () => {
        if (busy) return;
        setBusy(true);
        try { await exportAnalysis(run); }
        catch (err) { Alert.alert('Exportできませんでした', String(err)); }
        finally { setBusy(false); }
      }}><Text style={styles.text}>Analysis MarkdownをExport</Text></Pressable>
      <Pressable testID="move-to-trash" accessibilityRole="button" disabled={busy} onPress={trash} style={[styles.button, busy && styles.disabled]}><Text style={styles.text}>削除</Text></Pressable>
      <Text style={styles.title}>停止区間</Text>
      {!effective.intervals.length && <Text style={styles.text}>記録された停止区間はありません。</Text>}
      {effective.intervals.map(interval => <View key={interval.id} style={styles.row}>
        <Text style={styles.text}>{interval.kind === 'AUTO_STOP' ? 'Auto Stop（推定）' : 'Break（手動）'}</Text>
        <Text style={styles.text}>{clock(interval.startMs)} → {clock(interval.endMs)} · {duration(interval.durationMs)}</Text>
        <Text style={styles.text}>現在：{interval.included ? '走行に含む' : '走行から除外'}</Text>
        <Pressable testID={`stop-inclusion-${interval.id}`} accessibilityRole="button" disabled={busy} onPress={() => change(interval.id, !interval.included)} style={[styles.button, busy && styles.disabled]}><Text style={styles.text}>{interval.included ? '走行から除外する' : '走行に含める'}</Text></Pressable>
      </View>)}
      <Text style={styles.note}>訂正は時間とGPSから再評価した距離へ反映されます。元のGPS・時刻・推定は保持します。GPSが不足する区間や静止中の揺れは、含めても距離が増えないことがあります。</Text>
      <Text style={styles.title}>実走5分ラップ</Text>
      {laps.map((lap, index) => <Text key={index} style={styles.text}>{index + 1} · {duration(lap.durationMs)} · {(lap.distanceMeters / 1000).toFixed(2)} km · {pace(lap.secondsPerKm)}</Text>)}
      {isStandaloneTest() && <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/diagnostics', params: { id: run.id } })} style={styles.button}><Text style={styles.text}>この記録のDiagnostics</Text></Pressable>}
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111418' }, content: { padding: 24, paddingBottom: 48 },
  title: { color: '#F5F2EB', fontSize: 25, fontWeight: '700', marginTop: 24, marginBottom: 16 },
  text: { color: '#F5F2EB', fontSize: 16, lineHeight: 26 }, metric: { color: '#E85D2A', fontSize: 22, marginVertical: 16 },
  note: { color: '#A6A7A9', fontSize: 14, lineHeight: 23, marginTop: 20 }, row: { paddingVertical: 16, borderBottomWidth: 1, borderColor: '#30343A' },
  button: { minHeight: 52, backgroundColor: '#33424C', borderRadius: 12, padding: 14, marginTop: 12 }, disabled: { opacity: 0.5 },
});
