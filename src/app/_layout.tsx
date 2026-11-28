import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityBootstrap, ActivityEnvironment } from '@/components/activity-environment';
import { StorageCompatibilityGate } from '@/components/storage-compatibility-gate';
import '@/tasks/location-task';
import '@/tasks/cycling-location-task';
export default function RootLayout() {
  return <ActivityBootstrap><StorageCompatibilityGate><ActivityEnvironment>
    <StatusBar style="light" />
    <Stack screenOptions={{ headerShown: false }} />
  </ActivityEnvironment></StorageCompatibilityGate></ActivityBootstrap>;
}