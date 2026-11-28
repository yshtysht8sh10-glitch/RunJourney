import { Redirect, router } from 'expo-router';
import { Text } from 'react-native';
import { useActivityEnvironment } from '@/components/activity-environment';
import { ActivityButton, ActivityPage, activityStyles } from '@/components/activity-ui';
export default function TopHistory() {
  const { settings } = useActivityEnvironment();
  if (!settings.assistantEnabled) return <Redirect href={'/top/settings'} />;
  return <ActivityPage title="運動履歴">
    <Text style={activityStyles.muted}>統合履歴・サマリーは後続Phaseです。現在は競技別の保存済み記録を確認できます。</Text>
    <ActivityButton label="ランニングの履歴" onPress={() => router.push('/(running)/history')} />
    <ActivityButton label="サイクリングの履歴" onPress={() => router.push('/cycling/history')} />
  </ActivityPage>;
}
