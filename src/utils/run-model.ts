import { ActiveRun, LocationPoint, RunRecord, RunState, StopDiagnostic, StopReason } from '@/types/run';
import { calculateDistance, distanceBetween } from '@/utils/distance';
import { analyzePace, DEFAULT_LAP_MS, timeLapRanges } from '@/utils/pace-analysis';

export const RUN_CONTROL = {
  holdMs: 1500, stopSpeed: 0.6, resumeSpeed: 1.2,
  stopRadius: 8, resumeDistance: 10, stopMs: 5000,
  movementStep: 3, resumeFixes: 2,
  maxGapMs: 15000, observationTimeoutMs: 60000, accuracy: 20, maxSpeed: 12.5,
  diagnosticEntries: 720,
} as const;
export type PaceMode = 'active' | 'with-break' | 'wall';
export const stateOf = (run: Pick<RunRecord, 'events'>): RunState => run.events?.at(-1)?.state ?? 'RUNNING';

type TimeRun = Pick<ActiveRun, 'startedAt' | 'endedAt' | 'events' | 'stopOverrides'>;
const intervalId = (index: number, timestamp: number, state: RunState) => `${index}:${timestamp}:${state}`;
function effectiveEvents(run: Pick<RunRecord, 'events' | 'stopOverrides'>) {
  return (run.events ?? []).map((event, index) => event.state !== 'RUNNING' && run.stopOverrides?.[intervalId(index, event.timestamp, event.state)]?.included
    ? { ...event, state: 'RUNNING' as const } : event);
}
export function stopIntervals(run: TimeRun, now = Date.now()) {
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  return (run.events ?? []).flatMap((event, index, events) => {
    if (event.state === 'RUNNING') return [];
    const id = intervalId(index, event.timestamp, event.state);
    const startMs = Math.max(Date.parse(run.startedAt), event.timestamp);
    const endMs = Math.max(startMs, Math.min(end, events[index + 1]?.timestamp ?? end));
    return [{ id, kind: event.state, startMs, endMs, durationMs: endMs - startMs, included: run.stopOverrides?.[id]?.included === true }];
  });
}
export function timeModel(run: TimeRun, now = Date.now()) {
  const start = Date.parse(run.startedAt), end = run.endedAt ? Date.parse(run.endedAt) : now;
  const wallClockElapsed = Number.isFinite(end - start) ? Math.max(0, end - start) : 0;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { wallClockElapsed: 0, autoStoppedDuration: 0, breakDuration: 0, activeRunningTime: 0 };
  let autoStoppedDuration = 0, breakDuration = 0, cursor = start;
  let state: RunState = 'RUNNING';
  for (const event of effectiveEvents(run)) {
    if (!Number.isFinite(event.timestamp)) continue;
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
  if (!Number.isFinite(timestamp) || confirmedAt !== undefined && (!Number.isFinite(confirmedAt) || confirmedAt < timestamp)) return run;
  if (state === stateOf(run)) return run;
  if (state === 'AUTO_STOP' && !run.features?.autoStop) return run;
  if (state === 'BREAK' && !run.features?.break) return run;
  if (stateOf(run) === 'BREAK' && source === 'sensor') return run;
  const last = run.events?.at(-1)?.timestamp ?? Date.parse(run.startedAt);
  if (timestamp < last) return run;
  const event = { timestamp, state, source, ...(confirmedAt === undefined ? {} : { confirmedAt }) };
  return { ...run, events: [...(run.events ?? []), event], detector: {}, updatedAt: new Date(confirmedAt ?? timestamp).toISOString() };
}

type DistanceRun = Pick<ActiveRun, 'points' | 'events' | 'startedAt' | 'endedAt' | 'stopOverrides'>;
export function effectivePoints(run: DistanceRun): LocationPoint[] {
  const events = effectiveEvents(run);
  const included = stopIntervals(run, run.points.at(-1)?.timestamp ?? Date.parse(run.startedAt)).filter(interval => interval.included);
  // Only corrected intervals need this extra anchor filter. Legacy/default
  // distances retain their original semantics. Accumulate coherent displacement
  // instead of resurrecting every >3m jitter edge during a stationary interval.
  let anchor: LocationPoint | undefined, anchorInterval: string | undefined;
  const selected: LocationPoint[] = [];
  run.points.forEach((point, index) => {
    const interval = included.find(i => point.timestamp >= i.startMs && point.timestamp < i.endMs);
    if (interval) {
      if (anchorInterval !== interval.id) { anchor = undefined; anchorInterval = interval.id; }
      if (!Number.isFinite(point.accuracy) || point.accuracy! < 0 || point.accuracy! > RUN_CONTROL.accuracy) { selected.push({ ...point, accuracy: Infinity }); anchor = undefined; return; }
      if (anchor && distanceBetween(anchor, point) < RUN_CONTROL.stopRadius) return;
      selected.push(point); anchor = point; return;
    }
    anchor = undefined; anchorInterval = undefined;
    const previous = run.points[index - 1];
    const state = events.filter(e => e.timestamp <= point.timestamp).at(-1)?.state ?? 'RUNNING';
    // A confirmed sensor resume starts at a saved movement fix. That fix can
    // anchor its outgoing edge; its incoming edge is blocked by the stopped fix.
    // Manual/legacy resume keeps the existing conservative boundary handling.
    const crossing = previous && events.some(e => e.timestamp > previous.timestamp && e.timestamp <= point.timestamp
      && !(e.state === 'RUNNING' && e.source === 'sensor' && e.confirmedAt !== undefined));
    selected.push(state !== 'RUNNING' || crossing ? { ...point, accuracy: Infinity } : point);
  });
  return selected;
}
export function effectiveDistance(run: DistanceRun) { return effectiveEdges(run).reduce((sum, edge) => sum + edge.distanceMeters, 0); }

// Filter edges in raw GPS time, then place them on the shared effective clock.
// Every lap/total uses these same edges, including interpolated lap boundaries.
function effectiveEdges(run: DistanceRun, now?: number) {
  const points = effectivePoints(run), start = Date.parse(run.startedAt);
  const end = run.endedAt ? Date.parse(run.endedAt) : now ?? points.at(-1)?.timestamp ?? start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return points.slice(1).map((point, index) => {
    const previous = points[index], rawDuration = point.timestamp - previous.timestamp;
    const clippedStart = Math.max(start, previous.timestamp), clippedEnd = Math.min(end, point.timestamp);
    if (!Number.isFinite(rawDuration) || rawDuration <= 0 || clippedEnd <= clippedStart) return { startMs: 0, endMs: 0, distanceMeters: 0 };
    return {
      startMs: paceTime({ ...run, endedAt: undefined }, clippedStart),
      endMs: paceTime({ ...run, endedAt: undefined }, clippedEnd),
      distanceMeters: calculateDistance([previous, point]) * (clippedEnd - clippedStart) / rawDuration,
    };
  }).filter(edge => edge.endMs > edge.startMs && edge.distanceMeters > 0);
}
export function effectiveRun(run: ActiveRun, now = Date.now()) {
  const time = timeModel(run, now), edges = effectiveEdges(run, now);
  const distanceBetweenTimes = (startMs: number, endMs: number) => edges.reduce((sum, edge) => sum + edge.distanceMeters *
    Math.max(0, Math.min(endMs, edge.endMs) - Math.max(startMs, edge.startMs)) / (edge.endMs - edge.startMs), 0);
  const distanceMeters = edges.reduce((sum, edge) => sum + edge.distanceMeters, 0);
  const lap = (startMs: number, endMs: number) => analyzePace(startMs, endMs, distanceBetweenTimes(startMs, endMs));
  return { ...time, distanceMeters, intervals: stopIntervals(run, now),
    pace: analyzePace(0, time.activeRunningTime, distanceMeters),
    lap, laps: (intervalMs = DEFAULT_LAP_MS) => timeLapRanges(time.activeRunningTime, intervalMs).map(range => lap(range.startMs, range.endMs)),
  };
}

// Delivery time selects a completed interval; it never moves its boundaries.
export function completedLapAnalysis(run: ActiveRun, activeMs: number, intervalMs = DEFAULT_LAP_MS) {
  if (!Number.isFinite(activeMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const index = Math.floor(activeMs / intervalMs);
  if (index < 1) return null;
  const endMs = index * intervalMs, effective = effectiveRun(run);
  return { index, endMs, total: effective.lap(0, endMs), lap: effective.lap(endMs - intervalMs, endMs) };
}

export function recordDiagnostic(run: ActiveRun, entry: StopDiagnostic): ActiveRun {
  if (!run.diagnostics) return run;
  const key = entry.reason ? `${entry.decision}:${entry.reason}` : entry.decision;
  return { ...run, diagnostics: { entries: [...run.diagnostics.entries, entry].slice(-RUN_CONTROL.diagnosticEntries),
    processed: run.diagnostics.processed + 1, counts: { ...run.diagnostics.counts, [key]: (run.diagnostics.counts[key] ?? 0) + 1 } } };
}

export function detectStop(run: ActiveRun, point: LocationPoint): ActiveRun {
  const state = stateOf(run);
  let detail: Omit<StopDiagnostic, 'decision'> = { timestamp: point.timestamp, receivedAt: Date.now(), state, accuracy: point.accuracy, speed: point.speed };
  const report = (next: ActiveRun, decision: StopDiagnostic['decision'], reason?: StopDiagnostic['reason']) => recordDiagnostic(next, { ...detail, decision, reason, state: stateOf(next) });
  if (!run.features?.autoStop) return report(run, 'SKIP', StopReason.SETTING_DISABLED);
  if (state === 'BREAK') return report(run, 'SKIP', StopReason.STATE_CHANGED);
  const eventTime = run.events?.at(-1)?.confirmedAt ?? run.events?.at(-1)?.timestamp ?? Date.parse(run.startedAt);
  if (point.timestamp < eventTime) return report(run, 'SKIP', StopReason.STALE_FIX);
  // Older candidates were measured with the 20s algorithm; do not reinterpret them.
  let detector = run.detector?.version === 2 || run.detector?.version === 3 ? run.detector : {};
  let last = detector.last;
  const intervalMs = last ? point.timestamp - last.timestamp : undefined;
  const candidateStartedAt = detector.stillSince ?? detector.movement?.startedAt;
  detail = { ...detail, intervalMs, candidateStartedAt, candidateAgeMs: candidateStartedAt === undefined ? undefined : point.timestamp - candidateStartedAt };
  const usable = Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Number.isFinite(point.timestamp)
    && point.accuracy !== undefined && point.accuracy >= 0 && point.accuracy <= RUN_CONTROL.accuracy;
  if (last && point.timestamp <= last.timestamp) return report(run, 'SKIP', StopReason.STALE_FIX);
  const expired = intervalMs !== undefined && intervalMs > RUN_CONTROL.observationTimeoutMs;
  if (!usable) return report(expired ? { ...run, detector: { version: 3 } } : run,
    expired ? 'RESET' : 'HOLD', expired ? StopReason.CANDIDATE_TIMEOUT : StopReason.ACCURACY_POOR);
  if (expired) { detector = {}; last = undefined; }
  const gap = intervalMs !== undefined && intervalMs > RUN_CONTROL.maxGapMs;
  const step = last ? distanceBetween(last, point) : 0;
  const derived = last ? step / ((point.timestamp - last.timestamp) / 1000) : 0;
  const speed = point.speed !== undefined && Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : undefined;
  detail = { ...detail, effectiveSpeed: speed ?? derived, displacement: step };
  if (derived > RUN_CONTROL.maxSpeed || (speed !== undefined && speed > RUN_CONTROL.maxSpeed)) return report(expired ? { ...run, detector: { version: 3 } } : run, expired ? 'RESET' : 'HOLD', expired ? StopReason.CANDIDATE_TIMEOUT : StopReason.SPEED_SPIKE);
  const anchor = detector.anchor ?? point;
  const delta = distanceBetween(anchor, point);
  detail.originDisplacement = delta;

  if (stateOf(run) === 'AUTO_STOP') {
    // Missing observations cannot support retroactive *movement*. Re-anchor
    // resume evidence after a gap; keep AUTO_STOP and the physical stop anchor.
    if (gap || expired) return report({ ...run, detector: { version: 3, anchor, last: point } }, 'RESET', expired ? StopReason.CANDIDATE_TIMEOUT : StopReason.GPS_INTERVAL_TOO_LONG);
    const moving = !!last && step >= RUN_CONTROL.movementStep && (speed ?? derived) >= RUN_CONTROL.resumeSpeed;
    const movement = moving ? detector.movement
      ? { ...detector.movement, fixes: detector.movement.fixes + 1 }
      : { startedAt: point.timestamp, origin: point, fixes: 1 } : undefined;
    if (movement) detail = { ...detail, candidateStartedAt: movement.startedAt, candidateAgeMs: point.timestamp - movement.startedAt, originDisplacement: distanceBetween(movement.origin, point) };
    if (movement && movement.fixes >= RUN_CONTROL.resumeFixes && delta >= RUN_CONTROL.resumeDistance
      && distanceBetween(movement.origin, point) >= RUN_CONTROL.movementStep) {
      const resumed = transition(run, 'RUNNING', movement.startedAt, 'sensor', point.timestamp);
      return report({ ...resumed, detector: { version: 3, anchor: point, last: point } }, 'RESUME_CONFIRMED');
    }
    return report({ ...run, detector: { version: 3, anchor, last: point, movement } }, moving ? detector.movement ? 'CONTINUE' : 'START' : detector.movement ? 'RESET' : 'SKIP',
      moving ? undefined : detector.movement ? (speed ?? derived) < RUN_CONTROL.resumeSpeed ? StopReason.SPEED_TOO_LOW : StopReason.MOVEMENT_TOO_SMALL : StopReason.OBSERVATION_REQUIRED);
  }

  const noise = Math.min(RUN_CONTROL.stopRadius, Math.max(RUN_CONTROL.movementStep, ((last?.accuracy ?? 0) + point.accuracy!) / 2));
  const jitter = !!last && !gap && delta <= RUN_CONTROL.stopRadius && step <= noise && (speed === undefined || speed < RUN_CONTROL.resumeSpeed);
  // Bouncing in place can report speed without horizontal translation. The
  // existing distance filter treats <3m edges as non-movement as well.
  const stationaryEvidence = !!last && !gap && derived <= RUN_CONTROL.stopSpeed && step < RUN_CONTROL.movementStep && delta <= RUN_CONTROL.stopRadius;
  const slow = (speed ?? derived) <= RUN_CONTROL.stopSpeed || jitter || stationaryEvidence;
  if (!slow) return report({ ...run, detector: { version: 3, anchor: point, last: point } }, 'RESET', StopReason.SPEED_TOO_HIGH);
  // A long gap is unobserved, not movement. Only a fresh, accurate, explicitly
  // low-speed fix at the same stop origin can corroborate a pending candidate.
  if (gap && !expired && speed === undefined) return report({ ...run, detector: { ...detector, version: 3, last: point } }, 'HOLD', StopReason.GPS_INTERVAL_TOO_LONG);
  const continuing = detector.stillSince !== undefined && delta <= RUN_CONTROL.stopRadius;
  const stillSince = continuing ? detector.stillSince! : point.timestamp;
  const updated: ActiveRun = { ...run, detector: { version: 3, anchor: continuing ? anchor : point, last: point, stillSince } };
  detail = { ...detail, candidateStartedAt: stillSince, candidateAgeMs: point.timestamp - stillSince };
  if (point.timestamp - stillSince >= RUN_CONTROL.stopMs) {
    const stopped = transition(updated, 'AUTO_STOP', stillSince, 'sensor', point.timestamp);
    return report({ ...stopped, detector: { version: 3, anchor: point, last: point } }, 'STOP_CONFIRMED', gap ? StopReason.GPS_INTERVAL_TOO_LONG : undefined);
  }
  return report(updated, expired ? 'RESET' : continuing ? 'CONTINUE' : detector.stillSince !== undefined ? 'RESET' : 'START',
    expired ? StopReason.CANDIDATE_TIMEOUT : detector.stillSince !== undefined && !continuing ? StopReason.DISPLACEMENT_TOO_LARGE : undefined);
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
