import { useCallback, useState } from 'react';
import { Alert, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ActivityButton, ActivityMetric, ActivityPage, activityDuration, activityStyles } from '@/components/activity-ui';
import { StopButton } from '@/components/stop-button';
import { useActivityEnvironment } from '@/components/activity-environment';
import { CyclingService } from '@/services/cycling-service';
import { CyclingRepository } from '@/repositories/cycling-repository';
import { cyclingMetrics } from '@/domain/cycling-metrics';
import { stateOf } from '@/utils/run-model';
import type { CyclingDraft } from '@/repositories/cycling-recorder';
export default function CyclingScreen() {
  const { owner, refresh } = useActivityEnvironment();
  const [run, setRun] = useState<CyclingDraft | null>(null), [now, setNow] = useState(Date.now), [busy, setBusy] = useState(true), [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let alive = true;
    const read = async () => { const current = await CyclingService.getActive(); if (alive) { setRun(current); setNow(Date.now()); } };
    void CyclingService.restore().then(read).catch(failure => { if (alive) setError(String(failure)); return read(); }).finally(() => { if (alive) setBusy(false); });
    const timer = setInterval(() => { void read().catch(failure => { if (alive) setError(String(failure)); }); }, 1000);
    return () => { alive = false; clearInterval(timer); }; // Never stops GPS on navigation.
  }, []));
  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); setRun(await CyclingService.getActive()); await refresh(); }
    catch (failure) {
      setError(String(failure instanceof Error ? failure.message : failure));
      try { setRun(await CyclingService.getActive()); await refresh(); } catch { /* Keep the last known state, never fake IDLE. */ }
    }
    finally { setBusy(false); }
  };
  const start = () => Alert.alert('画面OFF中のGPS記録', '位置情報を「常に許可」にしてください。計測中はAndroidの通知が表示されます。',
    [{ text: 'キャンセル', style: 'cancel' }, { text: '開始', onPress: () => { void action(() => CyclingService.start()); } }]);
  const metrics = run ? cyclingMetrics(run, CyclingRepository.latestPoint ?? run.points.at(-1) ?? null, now) : null;
  return <ActivityPage title="サイクリング">
    {!!error && <Text accessibilityRole="alert" style={{ ...activityStyles.text, color: '#FFAD8C' }}>{error} 元の記録は保持しています。</Text>}
    {owner?.purpose === 'cycling' && owner.status !== 'ACTIVE' && <Text style={activityStyles.text}>開始・終了処理の確認が必要です（{owner.status}）。未完了の保存は終了ボタンで再試行してください。</Text>}
    {owner && owner.purpose !== 'cycling' && <Text style={activityStyles.muted}>別用途の計測・保存処理中です。新しい計測は開始できません。</Text>}
    <ActivityMetric label="走行距離" value={`${((metrics?.distanceMeters ?? 0) / 1000).toFixed(2)} km`} />
    <ActivityMetric label="現在速度" value={metrics?.currentKmh == null ? '-- km/h' : `${metrics.currentKmh.toFixed(1)} km/h`} />
    <ActivityMetric label="平均速度（停止・休憩を除く）" value={metrics?.averageKmh == null ? '-- km/h' : `${metrics.averageKmh.toFixed(1)} km/h`} />
    <Text style={activityStyles.text}>走行時間 {activityDuration(metrics?.activeRunningTime ?? 0)} ／ 経過時間 {activityDuration(metrics?.wallClockElapsed ?? 0)}</Text>
    {run ? <>
      <Text style={activityStyles.muted}>状態：{run.endedAt ? '保存再試行待ち' : stateOf(run) === 'RUNNING' ? '走行中' : stateOf(run) === 'BREAK' ? '手動休憩中' : '自動停止中'}　Auto Stop {run.features?.autoStop ? 'ON' : 'OFF'} ／ 5分音声 {run.cyclingSettings.voice ? 'ON' : 'OFF'}</Text>
      {!run.endedAt && <ActivityButton label={stateOf(run) === 'BREAK' ? '再開' : '休憩'} disabled={busy || owner?.status !== 'ACTIVE'}
        onPress={() => { void action(() => CyclingService.pause(stateOf(run) !== 'BREAK')); }} />}
      <StopButton disabled={busy} onStop={() => { void action(async () => {
        const saved = await CyclingService.stop(); if (saved) router.replace({ pathname: '/cycling/detail', params: { id: saved.id } });
      }); }} />
    </> : <ActivityButton label="START" disabled={busy || !!owner} onPress={start} />}
  </ActivityPage>;
}
