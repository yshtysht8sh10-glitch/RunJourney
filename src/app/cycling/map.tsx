import { ActivityRouteMap } from '@/components/activity-route-map';
import { CyclingSettingsRepository } from '@/repositories/cycling-settings';
import { cyclingDatabase } from '@/repositories/cycling-database';
import { SqlitePagedStore } from '@/repositories/paged-store';
import type { PagedRunSource } from '@/domain/pages';
import { router } from 'expo-router';
const loadEnabled = async () => (await CyclingSettingsRepository.get()).map;
const source = (id: string): PagedRunSource => ({
  summary: async () => new SqlitePagedStore(await cyclingDatabase()).source(id).summary(),
  read: async (kind, start) => new SqlitePagedStore(await cyclingDatabase()).source(id).read(kind, start),
});
const back = (id: string) => router.replace({ pathname: '/cycling/detail', params: { id } });
export default function CyclingMap() { return <ActivityRouteMap loadEnabled={loadEnabled} source={source} onBack={back} />; }
