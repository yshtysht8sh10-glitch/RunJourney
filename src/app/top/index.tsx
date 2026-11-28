import { useCallback } from 'react';
import { Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useActivityEnvironment } from '@/components/activity-environment';
import { ActivityButton, ActivityPage, activityStyles } from '@/components/activity-ui';
export default function AssistantEntry() {
  const { settings, owner, refresh } = useActivityEnvironment();
  useFocusEffect(useCallback(() => { void refresh().catch(() => undefined); }, [refresh]));
  return <ActivityPage title={settings.assistantEnabled ? '運動アシスタント' : '距離計測'}>
    {owner && <Text style={activityStyles.text}>{owner.purpose === 'running' ? 'ランニング' : 'サイクリング'}の計測・保存処理を継続中です。Topへの移動では停止しません。</Text>}
    {settings.assistantEnabled ? <>
      {!settings.onboardingSeen && <Text style={activityStyles.muted}>これまでのランニング機能・履歴・設定は「ランニング」から利用できます。</Text>}
      <ActivityButton label="ランニング" onPress={() => router.push('/(running)/run')} />
      <ActivityButton label="サイクリング" onPress={() => router.push('/cycling')} />
      <Text style={activityStyles.muted}>異なる用途を同時に計測することはできません。</Text>
    </> : <>
      <Text style={activityStyles.text}>汎用の非保存計測は後続Phaseで対応予定です。このTest候補では開始できません。</Text>
      <Text style={activityStyles.muted}>サイクリング・ランニングは設定で「運動のアシスタントとして使う」をONにすると利用できます。既存データは削除されません。</Text>
      <ActivityButton label="TOP設定を開く" onPress={() => router.push('/top/settings')} />
    </>}
  </ActivityPage>;
}
