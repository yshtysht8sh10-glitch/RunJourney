import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RunRepository } from '@/repositories/run-repository';
import { TRASH_RETENTION_MS, TrashedRun } from '@/utils/run-trash';
import { effectiveRun } from '@/utils/run-model';

export default function TrashScreen() {
  const [runs, setRuns] = useState<TrashedRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    setRuns(await RunRepository.getTrashedRuns()); setLoaded(true); setError('');
  }, []);
  useFocusEffect(useCallback(() => {
    let mounted = true;
    RunRepository.getTrashedRuns().then(records => { if (mounted) { setRuns(records); setLoaded(true); setError(''); } })
      .catch(() => { if (mounted) setError('ごみ箱を読み込めませんでした'); });
    return () => { mounted = false; };
  }, []));
  const perform = async (id: string, permanent: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (permanent) await RunRepository.deletePermanently(id);
      else await RunRepository.restoreFromTrash(id);
      await load();
    } catch (err) { Alert.alert('操作を完了できませんでした', String(err)); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try { await load(); } catch { setError('ごみ箱を読み込めませんでした'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <Pressable accessibilityRole="button" onPress={() => router.replace('/history')} style={styles.button}><Text style={styles.text}>‹ 履歴に戻る</Text></Pressable>
    <Text style={styles.title}>ごみ箱</Text>
    <Text style={styles.note}>移動から7日間は復元できます。7日を過ぎた記録は次の読み込み時に完全に削除されます。</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
    <FlatList data={runs} keyExtractor={item => item.id} contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor="#E85D2A" />}
      ListEmptyComponent={<Text style={styles.text}>{loaded ? 'ごみ箱は空です' : '読み込み中…'}</Text>}
      renderItem={({ item }) => {
        const effective = effectiveRun(item);
        return <View style={styles.row}>
          <Text style={styles.text}>{new Date(item.startedAt).toLocaleString('ja-JP')}</Text>
          <Text style={styles.text}>{(effective.distanceMeters / 1000).toFixed(2)} km / 全経過 {Math.floor(effective.wallClockElapsed / 60000)}分{Math.floor(effective.wallClockElapsed / 1000) % 60}秒</Text>
          <Text style={styles.note}>ごみ箱へ移動: {new Date(item.trashedAt).toLocaleString('ja-JP')}</Text>
          <Text style={styles.note}>完全削除予定: {new Date(item.trashedAt + TRASH_RETENTION_MS).toLocaleString('ja-JP')}</Text>
          <Pressable testID={`restore-${item.id}`} accessibilityRole="button" disabled={busy} onPress={() => perform(item.id, false)} style={[styles.button, busy && styles.disabled]}><Text style={styles.text}>復元</Text></Pressable>
          <Pressable testID={`delete-${item.id}`} accessibilityRole="button" disabled={busy} onPress={() => Alert.alert('完全に削除', 'この記録とGPSなどの関連データを完全に削除します。この操作は取り消せません。', [
            { text: 'キャンセル', style: 'cancel' }, { text: '完全に削除', style: 'destructive', onPress: () => perform(item.id, true) },
          ])} style={[styles.button, busy && styles.disabled]}><Text style={styles.danger}>完全に削除</Text></Pressable>
        </View>;
      }} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111418', paddingHorizontal: 24 }, list: { paddingBottom: 32 },
  title: { color: '#F5F2EB', fontSize: 32, fontWeight: '700', marginVertical: 20 },
  text: { color: '#F5F2EB', fontSize: 16, lineHeight: 26 }, note: { color: '#A6A7A9', fontSize: 14, lineHeight: 23, marginBottom: 12 },
  row: { paddingVertical: 20, borderBottomWidth: 1, borderColor: '#30343A' },
  button: { minHeight: 52, backgroundColor: '#33424C', borderRadius: 12, padding: 14, marginTop: 12 },
  danger: { color: '#FF9878', fontSize: 16 }, disabled: { opacity: 0.5 },
});
