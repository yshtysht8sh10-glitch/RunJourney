import { useCallback, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ActivityPage, activityStyles } from '@/components/activity-ui';
import { CyclingSettingsRepository, type CyclingSettings } from '@/repositories/cycling-settings';
export default function CyclingSettingsScreen() {
  const [settings, setSettings] = useState<CyclingSettings | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useFocusEffect(useCallback(() => { let alive = true;
    void CyclingSettingsRepository.get().then(value => { if (alive) { setSettings(value); setError(''); } }).catch(failure => { if (alive) setError(String(failure)); });
    return () => { alive = false; };
  }, []));
  const save = async (key: 'autoStop' | 'voice' | 'map', enabled: boolean) => {
    if (!settings) return; setBusy(true);
    try { const next = { ...settings, [key]: enabled }; await CyclingSettingsRepository.save(next); setSettings(next); }
    catch (failure) { Alert.alert('サイクリング設定を保存できません', String(failure)); }
    finally { setBusy(false); }
  };
  return <ActivityPage title="サイクリング設定">
    {!!error && <Text style={activityStyles.text}>{error} 元設定は保持しています。</Text>}
    <Text style={activityStyles.muted}>Auto Stopと音声は次のSTARTから適用します。ランニング側の設定には影響しません。</Text>
    {settings && (['autoStop', 'voice', 'map'] as const).map(key => <View key={key} style={activityStyles.card}>
      <Text style={activityStyles.text}>{key === 'autoStop' ? 'Auto Stop' : key === 'voice' ? '5分ごとの時間・距離・平均速度音声' : '地図・軌跡表示'}：{settings[key] ? 'ON' : 'OFF'}</Text>
      <Switch accessibilityLabel={key} value={settings[key]} disabled={busy} onValueChange={value => { void save(key, value); }} />
    </View>)}
    <Text style={activityStyles.muted}>GPS要求1秒・保存間隔5秒。サイクリングの調整値は実走受入前です。クラウド同期・バックアップ操作はこの候補では提供していません。</Text>
  </ActivityPage>;
}
