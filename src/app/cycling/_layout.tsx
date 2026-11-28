import { Redirect, Tabs } from 'expo-router';
import { TopReturn } from '@/components/top-return';
import { useActivityEnvironment } from '@/components/activity-environment';
export default function CyclingLayout() {
  const { settings, owner } = useActivityEnvironment();
  if (!settings.assistantEnabled && owner?.purpose !== 'cycling') return <Redirect href={'/top/settings'} />;
  return <Tabs screenOptions={{ headerShown: true, header: () => <TopReturn />, tabBarStyle: { backgroundColor: '#111418' },
    tabBarActiveTintColor: '#E85D2A', tabBarInactiveTintColor: '#BFC5CC' }}>
    <Tabs.Screen name="index" options={{ title: '計測' }} /><Tabs.Screen name="history" options={{ title: '履歴' }} />
    <Tabs.Screen name="settings" options={{ title: '設定' }} /><Tabs.Screen name="detail" options={{ href: null }} />
    <Tabs.Screen name="map" options={{ href: null }} />
  </Tabs>;
}
