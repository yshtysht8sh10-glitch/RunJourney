import type { ActiveRun, LocationPoint } from '@/types/run';
import { distanceBetween, usableDistancePoint } from '@/utils/distance';
import { stateOf, timeModel } from '@/utils/run-model';
import { CYCLING_PROFILE } from './measurement-profile';
export function cyclingMetrics(run: ActiveRun, latest: LocationPoint | null, now: number) {
  const time = timeModel(run, now), max = CYCLING_PROFILE.distance.maxSpeedMetersPerSecond;
  let currentKmh: number | null = null;
  if (latest && usableDistancePoint(latest) && latest.timestamp <= now && now - latest.timestamp <= 15000) {
    if (stateOf(run) !== 'RUNNING') currentKmh = 0;
    else if (Number.isFinite(latest.speed) && latest.speed! >= 0 && latest.speed! <= max) currentKmh = latest.speed! * 3.6;
    else {
      const points = [...run.points.slice(-3), latest].filter((p, i, all) => usableDistancePoint(p) && p.timestamp >= latest.timestamp - 10000
        && all.findIndex(q => q.timestamp === p.timestamp) === i).sort((a, b) => a.timestamp - b.timestamp);
      const rates = points.slice(1).map((p, i) => distanceBetween(points[i], p) / ((p.timestamp - points[i].timestamp) / 1000))
        .filter(rate => Number.isFinite(rate) && rate >= 0 && rate <= max).sort((a, b) => a - b);
      if (rates.length) currentKmh = rates[Math.floor(rates.length / 2)] * 3.6;
    }
  }
  return { ...time, distanceMeters: run.distanceMeters, currentKmh,
    averageKmh: time.activeRunningTime > 0 ? run.distanceMeters / time.activeRunningTime * 3600 : null };
}
