import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { cyclingDatabase } from '@/repositories/cycling-database';
import { ActivityButton, activityDuration, activityStyles } from '@/components/activity-ui';
type Rows = Awaited<ReturnType<Awaited<ReturnType<typeof cyclingDatabase>>['summaries']>>;
export default function CyclingHistory() {
  const [rows, setRows] = useState<Rows>([]), [more, setMore] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useFocusEffect(useCallback(() => { let alive = true;
    void cyclingDatabase().then(db => db.summaries(100, 0)).then(value => { if (alive) { setRows(value); setMore(value.length === 100); setError(''); } })
      .catch(failure => { if (alive) setError(String(failure)); }); return () => { alive = false; };
  }, []));
  const next = async () => {
    if (busy || !more) return; setBusy(true);
    try { const page = await (await cyclingDatabase()).summaries(100, rows.length); setRows(previous => [...previous, ...page]); setMore(page.length === 100); }
    catch (failure) { setError(String(failure)); } finally { setBusy(false); }
  };
  return <View style={[activityStyles.screen, { padding: 18 }]}>
    <Text style={activityStyles.title}>サイクリング履歴</Text>{!!error && <Text style={activityStyles.text}>{error}</Text>}
    <FlatList data={rows} keyExtractor={item => `cycling:${item.id}`} ListEmptyComponent={<Text style={activityStyles.muted}>{error ? '履歴を確認できません。元の記録は保持しています。' : '保存済みサイクリングはありません。'}</Text>}
      contentContainerStyle={{ gap: 14, paddingVertical: 20 }} renderItem={({ item }) => <ActivityButton
        label={`${new Date(item.started_at).toLocaleString('ja-JP')}　${(item.effective_distance / 1000).toFixed(2)} km\n${activityDuration(item.effective_time)}　平均 ${item.effective_time > 0 ? (item.effective_distance / item.effective_time * 3600).toFixed(1) : '--'} km/h`}
        onPress={() => router.push({ pathname: '/cycling/detail', params: { id: item.id } })} />}
      ListFooterComponent={more ? <ActivityButton label="さらに読み込む" disabled={busy} onPress={() => { void next(); }} /> : null} />
  </View>;
}
