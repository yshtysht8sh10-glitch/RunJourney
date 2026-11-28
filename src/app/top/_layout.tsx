import { Tabs } from 'expo-router';
import { useActivityEnvironment } from '@/components/activity-environment';
export default function TopLayout() {
  const { settings } = useActivityEnvironment();
  return <Tabs screenOptions={{ headerStyle: { backgroundColor: '#111418' }, headerTintColor: '#F5F2EB', headerTitle: 'RunJourney',
    tabBarStyle: { backgroundColor: '#111418' }, tabBarActiveTintColor: '#E85D2A', tabBarInactiveTintColor: '#BFC5CC' }}>
    <Tabs.Screen name="index" options={{ title: settings.assistantEnabled ? 'アシスタント' : '計測' }} />
    <Tabs.Screen name="history" options={{ title: '履歴', href: settings.assistantEnabled ? '/top/history' : null }} />
    <Tabs.Screen name="settings" options={{ title: '設定' }} />
  </Tabs>;
}
