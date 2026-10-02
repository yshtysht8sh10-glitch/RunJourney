import { ActiveRun, LocationPoint, RunRecord, RunState } from '@/types/run';
import { calculateDistance, distanceBetween } from '@/utils/distance';

export const RUN_CONTROL = {
  holdMs: 1500, stopSpeed: 0.6, resumeSpeed: 1.2,
  stopRadius: 8, resumeDistance: 10, stopMs: 5000,
  movementStep: 3, resumeFixes: 2,
  maxGapMs: 15000, accuracy: 20, maxSpeed: 12.5,
} as const;
export type PaceMode = 'active' | 'with-break' | 'wall';
export const stateOf = (run: Pick<RunRecord, 'events'>): RunState => run.events?.at(-1)?.state ?? 'RUNNING';

export function timeModel(run: Pick<ActiveRun, 'startedAt' | 'endedAt' | 'events'>, now = Date.now()) {
  const start = Date.parse(run.startedAt), end = run.endedAt ? Date.parse(run.endedAt) : now;
  const wallClockElapsed = Number.isFinite(end - start) ? Math.max(0, end - start) : 0;
  let autoStoppedDuration = 0, breakDuration = 0, cursor = start;
  let state: RunState = 'RUNNING';
  for (const event of run.events ?? []) {
    const next = Math.max(cursor, Math.min(end, event.timestamp));
    if (state === 'AUTO_STOP') autoStoppedDuration += next - cursor;
    if (state === 'BREAK') breakDuration += next - cursor;
    cursor = next; state = event.state;
  }
  if (state === 'AUTO_STOP') autoStoppedDuration += Math.max(0, end - cursor);
  if (state === 'BREAK') breakDuration += Math.max(0, end - cursor);
  return { wallClockElapsed, autoStoppedDuration, breakDuration, activeRunningTime: Math.max(0, wallClockElapsed - autoStoppedDuration - breakDuration) };
}
export function paceTime(run: Parameters<typeof timeModel>[0], now = Date.now(), mode: PaceMode = 'active') {
  const time = timeModel(run, now);
  return mode === 'wall' ? time.wallClockElapsed : time.activeRunningTime + (mode === 'with-break' ? time.breakDuration : 0);
}

// timestamp is effective activity time; confirmedAt records when the inference was made.
export function transition(run: ActiveRun, state: RunState, timestamp: number, source: 'sensor' | 'user', confirmedAt?: number): ActiveRun {
  if (state === stateOf(run)) return run;
  if (state === 'AUTO_STOP' && !run.features?.autoStop) return run;
  if (state === 'BREAK' && !run.features?.break) return run;
  if (stateOf(run) === 'BREAK' && source === 'sensor') return run;
  const last = run.events?.at(-1)?.timestamp ?? Date.parse(run.startedAt);
  if (timestamp < last) return run;
  const event = { timestamp, state, source, ...(confirmedAt === undefined ? {} : { confirmedAt }) };
  return { ...run, events: [...(run.events ?? []), event], detector: {}, updatedAt: new Date(confirmedAt ?? timestamp).toISOString() };
}

export function effectivePoints(run: Pick<RunRecord, 'points' | 'events' | 'startedAt'>): LocationPoint[] {
  return run.points.map((point, index) => {
    const previous = run.points[index - 1], events = run.events ?? [];
    const state = events.filter(e => e.timestamp <= point.timestamp).at(-1)?.state ?? 'RUNNING';
    // A confirmed sensor resume starts at a saved movement fix. That fix can
    // anchor its outgoing edge; its incoming edge is blocked by the stopped fix.
    // Manual/legacy resume keeps the existing conservative boundary handling.
    const crossing = previous && events.some(e => e.timestamp > previous.timestamp && e.timestamp <= point.timestamp
      && !(e.state === 'RUNNING' && e.source === 'sensor' && e.confirmedAt !== undefined));
    return state !== 'RUNNING' || crossing ? { ...point, accuracy: Infinity } : point;
  });
}
export function effectiveDistance(run: Pick<RunRecord, 'points' | 'events' | 'startedAt'>) { return calculateDistance(effectivePoints(run)); }

export function detectStop(run: ActiveRun, point: LocationPoint): ActiveRun {
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

export function effectiveTimeline(run: ActiveRun) {
  return effectivePoints(run).map(point => ({ ...point, timestamp: paceTime({ ...run, endedAt: undefined }, point.timestamp) }));
}

// Announcements cannot be undone. Auto Stop runs only publish time supported by
// processed fixes, stopping at a pending candidate until it confirms or cancels.
export function announcementClock(run: ActiveRun, now = Date.now()) {
  const activeMs = paceTime(run, now);
  const paused = stateOf(run) !== 'RUNNING';
  if (!run.features?.autoStop) return { activeMs, paused, confirmedActiveMs: -1 };
  const event = run.events?.at(-1);
  const boundary = run.detector?.stillSince ?? run.detector?.last?.timestamp ?? event?.confirmedAt ?? Date.parse(run.startedAt);
  const confirmedThrough = paused ? now : Math.min(now, Math.max(event?.timestamp ?? Date.parse(run.startedAt), boundary));
  return { activeMs, paused, confirmedActiveMs: paceTime(run, confirmedThrough) };
}
