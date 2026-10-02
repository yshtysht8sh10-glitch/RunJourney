import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BuildInfo } from '@/components/build-info';
import { RunService } from '@/services/run-service';
import { effectiveRun } from '@/utils/run-model';
import { RunRecord } from '@/types/run';

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function formatRunDateTime(value: string | undefined) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export default function HistoryScreen() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => setRuns(await RunService.getHistory()), []);

  useFocusEffect(useCallback(() => { load().catch(() => undefined); }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  return (
    <View style={styles.background}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <Text style={styles.title}>履歴</Text>
        <View style={styles.buildInfo}><BuildInfo /></View>
        <FlatList
          data={runs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={runs.length ? styles.list : styles.emptyList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#E85D2A" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>まだ記録がありません</Text><Text style={styles.emptyText}>最初のランニングを始めましょう。</Text></View>}
          renderItem={({ item }) => {
            const started = formatRunDateTime(item.startedAt);
            const ended = formatRunDateTime(item.endedAt);
            const effective = effectiveRun(item);
            return (
              <Pressable accessibilityRole="button" accessibilityLabel="走行履歴の詳細" onPress={() => router.push({ pathname: '/run-detail', params: { id: item.id } })} style={styles.row}>
                <View>
                  <Text style={styles.date}>{started ? dateFormatter.format(started) : '日付不明'}</Text>
                  <Text style={styles.times}>
                    {started ? timeFormatter.format(started) : '開始時刻不明'} → {ended ? timeFormatter.format(ended) : '終了時刻不明'}
                  </Text>
                  <Text style={styles.points}>GPSポイント {item.points.length}件 · 実走 {Math.floor(effective.activeRunningTime / 60000)}分 · 詳細 ›</Text>
                </View>
                <Text style={styles.distance}>{(effective.distanceMeters / 1000).toFixed(2)} km</Text>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#111418' }, container: { flex: 1 },
  title: { color: '#F5F2EB', fontSize: 38, fontWeight: '700', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 18 },
  buildInfo: { paddingHorizontal: 24, paddingBottom: 12 },
  list: { paddingHorizontal: 24, paddingBottom: 32 }, emptyList: { flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20, paddingHorizontal: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#363A3F' },
  date: { color: '#F5F2EB', fontSize: 16, fontWeight: '600' }, points: { color: '#777B80', fontSize: 12, marginTop: 6 },
  times: { color: '#C7CACD', fontSize: 15, marginTop: 6, fontVariant: ['tabular-nums'] },
  distance: { color: '#E85D2A', fontSize: 21, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  emptyTitle: { color: '#F5F2EB', fontSize: 20, fontWeight: '700' }, emptyText: { color: '#777B80', fontSize: 15, marginTop: 8 },
});
