import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
const runningScreens = new Set(['history', 'settings', 'history-groups', 'history-group-detail', 'run-recovery', 'run-summary',
  'run-detail', 'run-map', 'trash', 'diagnostics', 'marker-poc', 'sensor-diagnostics', 'cloud-sync', 'data-transfer']);
/** Keep old native deep links; params remain IDs, never database destinations. */
export function LegacyRunningRoute({ screen }: { screen: string }) {
  const params = useLocalSearchParams();
  if (!runningScreens.has(screen)) throw Error('未対応のランニング画面です');
  return <Redirect href={{ pathname: `/(running)/${screen}`, params } as Href} />;
}
