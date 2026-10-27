import { LocationPoint } from '@/types/run';
import { distanceBetween } from '@/utils/distance';

export const MOVEMENT_ALGORITHM = 'window-v5-stop-dwell';
/** Diagnostic contract for the unchanged detector. Metres, m/s and milliseconds. */
export const MOVEMENT_THRESHOLDS = Object.freeze({ accuracyMeters: 20, windowMs: 10000, maxGapMs: 15000,
  coverageMs: 5000, maxEdgeSpeed: 12.5, narrowSpread: 3, stationarySpeed: 0.35,
  dwellMs: 8000, dwellCount: 5, dwellSpread: 8, dwellCoherence: 0.35,
  movingSpeed: 0.7, movingCoherence: 0.7, movingEdgeSpeed: 0.5, movingEdgeRatio: 0.7 });

export function movementGates(s: ReturnType<typeof inferMovement>['summary']) {
  const t = MOVEMENT_THRESHOLDS;
  return { coverage: s.durationMs >= t.coverageMs && s.validCount >= 2 && s.edgesValid,
    narrowSpread: s.spread <= t.narrowSpread, stationarySpeed: s.displacementSpeed <= t.stationarySpeed,
    dwellDuration: s.durationMs >= t.dwellMs, dwellCount: s.validCount >= t.dwellCount,
    dwellSpread: s.spread <= t.dwellSpread, dwellCoherence: s.coherence <= t.dwellCoherence,
    movingSpeed: s.displacementSpeed >= t.movingSpeed, movingCoherence: s.coherence >= t.movingCoherence,
    movingCount: s.validCount >= 3, movingEdges: s.movingEdgeRatio >= t.movingEdgeRatio,
    stopFirstEdge: s.stopEvidence === 'bounded-dwell' || s.firstEdgeSpeed <= .5,
    resumeFirstEdge: s.firstEdgeSpeed >= .5 };
}
export const usableObservation = (p: LocationPoint) => Number.isFinite(p.timestamp)
  && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90
  && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180
  && Number.isFinite(p.accuracy) && p.accuracy! >= 0 && p.accuracy! <= 20;

/** Position evidence is primary. Provider speed alone cannot prove translation. */
export function inferMovement(points: LocationPoint[]) {
  const durationMs = points.length > 1 ? points.at(-1)!.timestamp - points[0].timestamp : 0;
  const distances = points.slice(1).map((p, i) => distanceBetween(points[i], p));
  const rates = distances.map((d, i) => d / ((points[i + 1].timestamp - points[i].timestamp) / 1000));
  const displacement = points.length > 1 ? distanceBetween(points[0], points.at(-1)!) : 0;
  const pathLength = distances.reduce((a, b) => a + b, 0);
  const spread = points.reduce((max, p, i) => Math.max(max, ...points.slice(i + 1).map(q => distanceBetween(p, q))), 0);
  const speeds = points.map(p => p.speed).filter((v): v is number => v !== undefined && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const speedMedian = speeds.length ? speeds[Math.floor(speeds.length / 2)] : undefined;
  const coherence = pathLength ? displacement / pathLength : 0;
  const displacementSpeed = durationMs > 0 ? displacement / (durationMs / 1000) : 0;
  const movingEdgeRatio = rates.length ? rates.filter(r => r >= 0.5).length / rates.length : 0;
  const covered = durationMs >= 5000 && points.length >= 2 && rates.every(r => Number.isFinite(r) && r <= 12.5);
  const moving = covered && points.length >= 3 && displacement / (durationMs / 1000) >= 0.7
    && coherence >= 0.7 && rates.filter(r => r >= 0.5).length >= Math.ceil(rates.length * 0.7);
  const stationary = covered && spread <= 3 && displacement / (durationMs / 1000) <= 0.35;
  // A bounded, reversing path is dwell evidence even when individual edges
  // are fast. Require longer coverage than the existing narrow stillness rule.
  // Walking/jogging has coherent translation and cannot qualify here.
  const boundedDwell = covered && durationMs >= 8000 && points.length >= 5
    && spread <= 8 && displacementSpeed <= 0.35 && coherence <= 0.35 && !moving;
  const summary = { durationMs, validCount: points.length, displacement, pathLength, spread, speedMedian, coherence,
    displacementSpeed, movingEdgeRatio, maxEdgeSpeed: Math.max(0, ...rates), firstEdgeSpeed: rates[0] ?? 0,
    edgesValid: rates.every(r => Number.isFinite(r) && r <= 12.5),
    stopEvidence: stationary ? 'narrow-stillness' as const : boundedDwell ? 'bounded-dwell' as const : 'none' as const };
  return { summary, moving, boundedDwell, stationary: stationary || boundedDwell };

}
