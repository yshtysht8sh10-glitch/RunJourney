import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '@/tasks/location-task';

export default function TabLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#E85D2A',
          tabBarInactiveTintColor: '#787C82',
          tabBarStyle: { backgroundColor: '#111418', borderTopColor: '#272B30' },
        }}>
        <Tabs.Screen name="index" options={{ title: 'ラン' }} />
        <Tabs.Screen name="history" options={{ title: '履歴' }} />
        <Tabs.Screen name="settings" options={{ title: '設定' }} />
        <Tabs.Screen name="run-recovery" options={{ href: null }} />
        <Tabs.Screen name="run-detail" options={{ href: null }} />
        <Tabs.Screen name="trash" options={{ href: null }} />
        <Tabs.Screen name="diagnostics" options={{ href: null }} />
      </Tabs>
    </>
  );
}
