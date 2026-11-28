import { ActivityRouteMap } from '@/components/activity-route-map';
import { RouteMapSettings } from '@/repositories/route-map-settings';
import { RunRepository } from '@/repositories/run-repository';
export default function RunMap() { return <ActivityRouteMap loadEnabled={RouteMapSettings.get} source={RunRepository.pagedSource} />; }