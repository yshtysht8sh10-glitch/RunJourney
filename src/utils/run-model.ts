import { ActiveRun, LocationPoint, RunRecord, RunState } from '@/types/run';
import { calculateDistance, distanceBetween } from '@/utils/distance';
export const RUN_CONTROL = { holdMs: 1500, stopSpeed: 0.6, resumeSpeed: 1.2, stopRadius: 8, resumeDistance: 10, stopMs: 20000, maxGapMs: 15000, accuracy: 20, maxSpeed: 12.5 } as const;
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
export function transition(run: ActiveRun, state: RunState, timestamp: number, source: 'sensor' | 'user'): ActiveRun {
  if (state === stateOf(run)) return run;
  if (state === 'AUTO_STOP' && !run.features?.autoStop) return run;
  if (state === 'BREAK' && !run.features?.break) return run;
  if (stateOf(run) === 'BREAK' && source === 'sensor') return run;
  const last = run.events?.at(-1)?.timestamp ?? Date.parse(run.startedAt);
  if (timestamp < last) return run;
  return { ...run, events: [...(run.events ?? []), { timestamp, state, source }], detector: {}, updatedAt: new Date(timestamp).toISOString() };
}
export function effectivePoints(run: Pick<RunRecord, 'points' | 'events' | 'startedAt'>): LocationPoint[] {
  return run.points.map((point, index) => {
    const previous = run.points[index - 1], events = run.events ?? [];
    const state = events.filter(e => e.timestamp <= point.timestamp).at(-1)?.state ?? 'RUNNING';
    const crossing = previous && events.some(e => e.timestamp > previous.timestamp && e.timestamp <= point.timestamp);
    return state !== 'RUNNING' || crossing ? { ...point, accuracy: Infinity } : point;
  });
}
export function effectiveDistance(run: Pick<RunRecord, 'points' | 'events' | 'startedAt'>) { return calculateDistance(effectivePoints(run)); }
export function detectStop(run: ActiveRun, point: LocationPoint): ActiveRun {
  if (!run.features?.autoStop || stateOf(run) === 'BREAK') return run;
  const detector = run.detector ?? {}, last = detector.last;
  const usable = Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Number.isFinite(point.timestamp)
    && point.accuracy !== undefined && point.accuracy >= 0 && point.accuracy <= RUN_CONTROL.accuracy;
  if (!usable || (last && (point.timestamp <= last.timestamp || point.timestamp - last.timestamp > RUN_CONTROL.maxGapMs))) {
    return { ...run, detector: usable ? { anchor: point, last: point, stillSince: point.timestamp } : {} };
  }
  const anchor = detector.anchor ?? point, delta = distanceBetween(anchor, point);
  const speed = point.speed !== undefined && Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : undefined;
  const derived = last ? distanceBetween(last, point) / ((point.timestamp - last.timestamp) / 1000) : 0;
  if (derived > RUN_CONTROL.maxSpeed || (speed !== undefined && speed > RUN_CONTROL.maxSpeed)) return { ...run, detector: {} };
  if (stateOf(run) === 'AUTO_STOP') {
    if (delta >= RUN_CONTROL.resumeDistance && (speed === undefined ? derived >= RUN_CONTROL.resumeSpeed : speed >= RUN_CONTROL.resumeSpeed)) return transition(run, 'RUNNING', point.timestamp, 'sensor');
    return { ...run, detector: { ...detector, anchor, last: point } };
  }
  const still = delta <= RUN_CONTROL.stopRadius && (speed === undefined || speed <= RUN_CONTROL.stopSpeed);
  const stillSince = still ? detector.stillSince ?? point.timestamp : point.timestamp;
  const updated = { ...run, detector: { anchor: still ? anchor : point, last: point, stillSince } };
  if (still && point.timestamp - stillSince >= RUN_CONTROL.stopMs) {
    const stopped = transition(updated, 'AUTO_STOP', point.timestamp, 'sensor');
    return { ...stopped, detector: { anchor: point, last: point } };
  }
  return updated;
}


export function effectiveTimeline(run: ActiveRun) {
  return effectivePoints(run).map(point => ({ ...point, timestamp: paceTime({ ...run, endedAt: undefined }, point.timestamp) }));
}
