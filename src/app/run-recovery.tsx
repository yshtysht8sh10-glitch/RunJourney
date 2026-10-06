import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { recoveryPreview } from '@/utils/run-recovery';

const duration = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export default function RunRecovery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<RunRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let mounted = true;
    RunRepository.getBackupRuns().then(runs => {
      if (!mounted) return;
      const found = runs.find(r => r.id === id && r.trashedAt == null);
      setRun(found ?? null); if (!found) setError('記録が見つかりません');
    }).catch(() => mounted && setError('記録を読み込めませんでした'));
    return () => { mounted = false; };
  }, [id]));
  const result = useMemo(() => {
    if (!run) return null;
    try { return { preview: recoveryPreview(run), error: '' }; }
    catch (err) { return { preview: null, error: err instanceof Error ? err.message : String(err) }; }
  }, [run]);
  const save = async (enabled: boolean) => {
    if (!run || busy) return;
    setBusy(true);
    try { setRun(await RunRepository.setRecovery(run.id, enabled)); }
    catch (err) { Alert.alert('保存できませんでした', String(err)); }
    finally { setBusy(false); }
  };
  const preview = result?.preview;
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.back()}><Text style={styles.text}>‹ 走行詳細へ戻る</Text></Pressable>
    <Text style={styles.title}>GPSデータから履歴を復元</Text>
    <Text style={styles.text}>保存GPSからAuto Stopを再解析します。表示を開いただけでは記録を変更しません。</Text>
    {!!(error || result?.error) && <Text style={styles.text}>{error || result?.error}</Text>}
    {preview && <>
      {([['現在', preview.current], ['復元候補', preview.proposed]] as const).map(([label, value]) => <Text key={label} style={styles.metric}>
        {label}{'\n'}距離 {(value.distanceMeters / 1000).toFixed(2)} km{'\n'}実走時間 {duration(value.activeRunningTime)}{'\n'}平均速度 {value.pace.kmPerHour?.toFixed(2) ?? '—'} km/h
      </Text>)}
      <Text style={styles.text}>元のAuto Stop除外区間で回復する候補：{(preview.restoredDistanceMeters / 1000).toFixed(2)} km / {duration(preview.restoredTimeMs)}</Text>
      {preview.warnings.map(message => <Text key={message} style={styles.note}>{message}</Text>)}
      <Text style={styles.note}>元のGPS・時刻・距離・推定は保持します。手動Breakは自動解除しません。復元後は「元の記録へ戻す」で取り消せます。</Text>
      {!run?.recovery && <Pressable testID="recovery-apply" accessibilityRole="button" style={styles.button} disabled={busy} onPress={() => Alert.alert('復元候補を適用', '表示された候補を適用します。元の記録へ戻せます。', [
        { text: 'キャンセル', style: 'cancel' }, { text: '適用する', onPress: () => save(true) },
      ])}><Text style={styles.text}>この復元候補を適用する</Text></Pressable>}
    </>}
    {run?.recovery && <Pressable testID="recovery-undo" accessibilityRole="button" style={styles.button} disabled={busy} onPress={() => save(false)}><Text style={styles.text}>元の記録へ戻す</Text></Pressable>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#111418' }, content: { padding: 24, paddingBottom: 48 },
  title: { color: '#F5F2EB', fontSize: 24, fontWeight: '700', marginVertical: 20 },
  text: { color: '#F5F2EB', fontSize: 16, lineHeight: 26 }, metric: { color: '#F5F2EB', fontSize: 20, lineHeight: 32, marginVertical: 20 },
  note: { color: '#A6A7A9', fontSize: 14, lineHeight: 23, marginTop: 16 },
  button: { minHeight: 52, backgroundColor: '#33424C', borderRadius: 12, padding: 14, marginTop: 16 },
});
