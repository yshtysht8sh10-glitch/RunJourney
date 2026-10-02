// Frozen v4 detector for read-only replay of historical GPS. Never used for tracking.
import { ActiveRun, LocationPoint } from '@/types/run';
import { distanceBetween } from '@/utils/distance';
import { stateOf, transition } from '@/utils/run-model';
// These historical parameters must not follow future production tuning.
const RUN_CONTROL = { stopSpeed: 0.6, resumeSpeed: 1.2, stopRadius: 8, resumeDistance: 10,
  stopMs: 5000, movementStep: 3, resumeFixes: 2, maxGapMs: 15000, accuracy: 20, maxSpeed: 12.5 };

export function legacyDetectStop(run: ActiveRun, point: LocationPoint): ActiveRun {
  if (!run.features?.autoStop || stateOf(run) === 'BREAK') return run;
  const eventTime = run.events?.at(-1)?.confirmedAt ?? run.events?.at(-1)?.timestamp ?? Date.parse(run.startedAt);
  if (point.timestamp < eventTime) return run;
  // Older candidates were measured with the 20s algorithm; do not reinterpret them.
  let detector = run.detector?.version === 2 ? run.detector : {};
  let last = detector.last;
  const usable = Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Number.isFinite(point.timestamp)
    && point.accuracy !== undefined && point.accuracy >= 0 && point.accuracy <= RUN_CONTROL.accuracy;
  if (!usable) return { ...run, detector: { version: 2 } };
  if (last && point.timestamp <= last.timestamp) return run;
  if (last && point.timestamp - last.timestamp > RUN_CONTROL.maxGapMs) { detector = {}; last = undefined; }
  const step = last ? distanceBetween(last, point) : 0;
  const derived = last ? step / ((point.timestamp - last.timestamp) / 1000) : 0;
  const speed = point.speed !== undefined && Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : undefined;
  if (derived > RUN_CONTROL.maxSpeed || (speed !== undefined && speed > RUN_CONTROL.maxSpeed)) return { ...run, detector: { version: 2 } };
  const anchor = detector.anchor ?? point;
  const delta = distanceBetween(anchor, point);

  if (stateOf(run) === 'AUTO_STOP') {
    const moving = !!last && step >= RUN_CONTROL.movementStep && (speed ?? derived) >= RUN_CONTROL.resumeSpeed;
    const movement = moving ? detector.movement
      ? { ...detector.movement, fixes: detector.movement.fixes + 1 }
      : { startedAt: point.timestamp, origin: point, fixes: 1 } : undefined;
    if (movement && movement.fixes >= RUN_CONTROL.resumeFixes && delta >= RUN_CONTROL.resumeDistance
      && distanceBetween(movement.origin, point) >= RUN_CONTROL.movementStep) {
      const resumed = transition(run, 'RUNNING', movement.startedAt, 'sensor', point.timestamp);
      return { ...resumed, detector: { version: 2, anchor: point, last: point } };
    }
    return { ...run, detector: { version: 2, anchor, last: point, movement } };
  }

  const slow = (speed ?? derived) <= RUN_CONTROL.stopSpeed;
  if (!slow) return { ...run, detector: { version: 2, anchor: point, last: point } };
  const continuing = detector.stillSince !== undefined && delta <= RUN_CONTROL.stopRadius;
  const stillSince = continuing ? detector.stillSince! : point.timestamp;
  const updated: ActiveRun = { ...run, detector: { version: 2, anchor: continuing ? anchor : point, last: point, stillSince } };
  if (point.timestamp - stillSince >= RUN_CONTROL.stopMs) {
    const stopped = transition(updated, 'AUTO_STOP', stillSince, 'sensor', point.timestamp);
    return { ...stopped, detector: { version: 2, anchor: point, last: point } };
  }
  return updated;
}

