import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { cyclingDatabase } from '@/repositories/cycling-database';
import { SqlitePagedStore } from '@/repositories/paged-store';
import { CyclingSettingsRepository } from '@/repositories/cycling-settings';
import type { RunSummary } from '@/domain/pages';
import { ActivityButton, ActivityPage, activityDuration, activityStyles } from '@/components/activity-ui';
export default function CyclingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [summary, setSummary] = useState<RunSummary | null>(null), [error, setError] = useState(''), [map, setMap] = useState(false);
  useFocusEffect(useCallback(() => { let alive = true;
    void (async () => {
      if (typeof id !== 'string' || !id.trim() || id.length > 256) throw Error('記録IDを確認できません');
      const value = await new SqlitePagedStore(await cyclingDatabase()).source(id).summary();
      if (value.error || value.trashedAt != null) throw Error(value.error || 'ごみ箱の記録は詳細表示できません');
      const settings = await CyclingSettingsRepository.get();
      if (alive) { setSummary(value); setMap(settings.map); setError(''); }
    })().catch(failure => { if (alive) setError(String(failure)); }); return () => { alive = false; };
  }, [id]));
  return <ActivityPage title="サイクリング詳細">
    {!!error && <Text style={activityStyles.text}>{error} 元の記録は保持しています。</Text>}
    {summary?.id === id && <>
      <Text style={activityStyles.text}>{new Date(summary.startedAt).toLocaleString('ja-JP')}</Text>
      <Text style={activityStyles.title}>{(summary.distanceMeters / 1000).toFixed(2)} km</Text>
      <Text style={activityStyles.text}>走行時間 {activityDuration(summary.activeRunningTime)} ／ 平均 {summary.activeRunningTime > 0 ? (summary.distanceMeters / summary.activeRunningTime * 3600).toFixed(1) : '--'} km/h</Text>
      <Text style={activityStyles.muted}>保存GPS {summary.pointCount}点</Text>
      <ActivityButton label={map ? '地図・軌跡を開く' : '地図・軌跡は設定でOFFです'} disabled={!map}
        onPress={() => router.push({ pathname: '/cycling/map', params: { id } })} />
    </>}
    <ActivityButton label="サイクリング履歴へ" onPress={() => router.replace('/cycling/history')} />
  </ActivityPage>;
}
