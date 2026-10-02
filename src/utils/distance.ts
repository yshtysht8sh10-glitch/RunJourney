import { LocationPoint } from '@/types/run';

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_USABLE_ACCURACY_METERS = 50;
const MAX_RUNNING_SPEED_METERS_PER_SECOND = 12.5;
const MIN_MOVEMENT_METERS = 3;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceBetween(a: LocationPoint, b: LocationPoint): number {
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const latitude1 = toRadians(a.latitude);
  const latitude2 = toRadians(b.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function calculateDistance(points: LocationPoint[]): number {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;

    if (elapsedSeconds <= 0) continue;
    if ((previous.accuracy ?? 0) > MAX_USABLE_ACCURACY_METERS) continue;
    if ((current.accuracy ?? 0) > MAX_USABLE_ACCURACY_METERS) continue;

    const segment = distanceBetween(previous, current);
    if (!Number.isFinite(segment)) continue;
    if (segment < MIN_MOVEMENT_METERS) continue;
    if (segment / elapsedSeconds > MAX_RUNNING_SPEED_METERS_PER_SECOND) continue;

    total += segment;
  }

  return total;
}
