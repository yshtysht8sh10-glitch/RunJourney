import { Redirect } from 'expo-router';
import { useActivityEnvironment } from '@/components/activity-environment';
export default function Entry() {
  const { owner } = useActivityEnvironment();
  if (owner?.purpose === 'running') return <Redirect href={'/(running)/run'} />;
  if (owner?.purpose === 'cycling') return <Redirect href={'/cycling'} />;
  return <Redirect href={'/top'} />;
}
