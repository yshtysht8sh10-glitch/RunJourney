import { useCallback, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useActivityEnvironment } from '@/components/activity-environment';
import { ActivityPage, activityStyles } from '@/components/activity-ui';
import { TopSettingsRepository, effectiveTimeEnabled } from '@/repositories/top-settings';
export default function TopSettingsScreen() {
  const { settings, owner, refresh } = useActivityEnvironment(); const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => { void refresh().catch(() => undefined); }, [refresh]));
  const save = async (patch: Partial<typeof settings>) => {
    setBusy(true);
    try { await TopSettingsRepository.save({ ...settings, ...patch, onboardingSeen: true }); await refresh(); }
    catch (error) { Alert.alert('TOP設定を保存できません', String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  return <ActivityPage title="TOP設定">
    {owner && <Text style={activityStyles.muted}>計測・保存処理中は用途と時間計測設定を変更できません。</Text>}
    <View style={activityStyles.card}><Text style={activityStyles.text}>運動のアシスタントとして使う：{settings.assistantEnabled ? 'ON' : 'OFF'}</Text>
      <Switch accessibilityLabel="運動のアシスタントとして使う" value={settings.assistantEnabled} disabled={busy || !!owner}
        onValueChange={value => { void save({ assistantEnabled: value }); }} />
      <Text style={activityStyles.muted}>OFFにしても各競技の設定・履歴・GPSは保持します。</Text>
    </View>
    <View style={activityStyles.card}><Text style={activityStyles.text}>時間計測：{effectiveTimeEnabled(settings) ? 'ON' : 'OFF'}</Text>
      <Switch accessibilityLabel="時間計測" value={effectiveTimeEnabled(settings)} disabled={busy || !!owner || settings.assistantEnabled}
        onValueChange={value => { void save({ genericTimeEnabled: value }); }} />
      <Text style={activityStyles.muted}>{settings.assistantEnabled ? 'アシスタント使用中はON固定です。OFFに戻すと以前の汎用時間設定を使います。' : '汎用の時間計測機能は後続Phaseで対応予定です。'}</Text>
    </View>
  </ActivityPage>;
}
