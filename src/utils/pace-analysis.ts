import { LocationPoint } from '@/types/run';
import { calculateDistance } from '@/utils/distance';

export const MARATHON_METERS = 42_195;
export const DEFAULT_LAP_MS = 5 * 60_000;

export function timeLapRanges(durationMs: number, intervalMs = DEFAULT_LAP_MS) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) return [];
  return Array.from({ length: Math.ceil(durationMs / intervalMs) }, (_, index) => ({
    startMs: index * intervalMs, endMs: Math.min((index + 1) * intervalMs, durationMs),
  }));
}

export type PaceAnalysis = {
  startMs: number;
  endMs: number;
  durationMs: number;
  distanceMeters: number;
  secondsPerKm: number | null;
  kmPerHour: number | null;
  projectedTimeSeconds: (targetMeters: number) => number | null;
};

export function analyzePace(startMs: number, endMs: number, distanceMeters: number): PaceAnalysis {
  const durationMs = endMs - startMs;
  const valid = Number.isFinite(durationMs) && durationMs > 0 && Number.isFinite(distanceMeters) && distanceMeters > 0;
  return {
    startMs, endMs, durationMs, distanceMeters,
    secondsPerKm: valid ? durationMs / 1000 / (distanceMeters / 1000) : null,
    kmPerHour: valid ? distanceMeters / (durationMs / 3_600_000) / 1000 : null,
    projectedTimeSeconds: (targetMeters) => valid && Number.isFinite(targetMeters) && targetMeters > 0
      ? durationMs / 1000 * targetMeters / distanceMeters : null,
  };
}

// Include a fix immediately before the boundary so the first in-window segment
// is measured, while preserving the same GPS filters used by run distance.
export function analyzePoints(points: LocationPoint[], startMs: number, endMs: number): PaceAnalysis | null {
  const ordered = [...points].sort((a, b) => a.timestamp - b.timestamp);
  if (ordered.filter((point) => point.timestamp >= startMs && point.timestamp <= endMs).length < 2) return null;
  let distance = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const overlap = Math.min(current.timestamp, endMs) - Math.max(previous.timestamp, startMs);
    if (overlap <= 0 || current.timestamp <= previous.timestamp) continue;
    distance += calculateDistance([previous, current]) * overlap / (current.timestamp - previous.timestamp);
  }
  return analyzePace(startMs, endMs, distance);
}
