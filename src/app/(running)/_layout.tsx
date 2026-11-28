import { Redirect, Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TopReturn } from '@/components/top-return';
import { paceEditorDirty, requestPaceLeave } from '@/services/pace-edit-guard';
import { useActivityEnvironment } from '@/components/activity-environment';
export default function RunningLayout() {
  const { settings, owner } = useActivityEnvironment();
  if (!settings.assistantEnabled && owner?.purpose !== 'running') return <Redirect href={'/top/settings'} />;
  return <>
    <StatusBar style="light" />
    <Tabs screenListeners={({ navigation, route }) => ({ tabPress: event => {
      if (route.name !== 'settings' && paceEditorDirty()) { event.preventDefault(); requestPaceLeave(() => navigation.navigate(route.name)); }
    } })} screenOptions={{ headerShown: true, header: () => <TopReturn />,
      tabBarActiveTintColor: '#E85D2A', tabBarInactiveTintColor: '#787C82',
      tabBarStyle: { backgroundColor: '#111418', borderTopColor: '#272B30' } }}>
      <Tabs.Screen name="run" options={{ title: 'ラン' }} /><Tabs.Screen name="history" options={{ title: '履歴' }} />
      <Tabs.Screen name="settings" options={{ title: '設定' }} />
      <Tabs.Screen name="history-groups" options={{ href: null }} /><Tabs.Screen name="history-group-detail" options={{ href: null }} />
      <Tabs.Screen name="run-recovery" options={{ href: null }} /><Tabs.Screen name="run-summary" options={{ href: null }} />
      <Tabs.Screen name="run-detail" options={{ href: null }} /><Tabs.Screen name="run-map" options={{ href: null }} />
      <Tabs.Screen name="trash" options={{ href: null }} /><Tabs.Screen name="diagnostics" options={{ href: null }} />
      <Tabs.Screen name="marker-poc" options={{ href: null }} /><Tabs.Screen name="sensor-diagnostics" options={{ href: null }} />
      <Tabs.Screen name="cloud-sync" options={{ href: null }} /><Tabs.Screen name="data-transfer" options={{ href: null }} />
    </Tabs>
  </>;
}
