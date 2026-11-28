import { CYCLING_PROFILE } from '@/domain/measurement-profile';
import { GpsObservationSession, type RawLocationObservation } from '@/utils/gps-observation';
import { detectStop, effectiveDistance, stateOf, transition } from '@/utils/run-model';
import type { ActiveRun, RunRecord } from '@/types/run';
import type { SqliteStore } from './sqlite-store';
import { type CyclingSettings, validateCyclingSettings } from './cycling-settings';

export type CyclingDraft = ActiveRun & { cyclingSettings: CyclingSettings };
/** Shared SqliteStore/observation/detector/time/distance components, independent recorder state.
 * Each ingest awaits its required durable checkpoint: the caller's Native lease covers all I/O.
 * Never touches Running repositories, diagnostic journals, PACE or cloud queues.
 */
export class CyclingRecorder {
  private queue: Promise<unknown> = Promise.resolve();
  private active: CyclingDraft | null = null;
  private observation: GpsObservationSession | null = null;
  private pending: CyclingDraft | null = null;
  constructor(private readonly open: () => Promise<SqliteStore>) {}
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation); this.queue = next.catch(() => undefined); return next;
  }
  private async restore() {
    if (this.active) return this.active;
    const stored = await (await this.open()).getDraft();
    if (!stored) return null;
    const value = stored as CyclingDraft;
    validateCyclingSettings(value.cyclingSettings);
    this.active = value;
    this.observation = new GpsObservationSession(value.points.at(-1)?.timestamp, value.diagnostics?.counts?.GPS_OBS_LAST_TIMESTAMP);
    return value;
  }
  getActive() { return this.serialized(() => this.restore()); }
  create(id: string, startedAt: string, settings: CyclingSettings) {
    return this.serialized(async () => {
      if (await this.restore()) throw Error('サイクリングの未終了記録があります');
      const fixed = validateCyclingSettings(settings);
      const active: CyclingDraft = { id, startedAt, createdAt: startedAt, updatedAt: startedAt, distanceMeters: 0,
        points: [], events: [], features: { autoStop: fixed.autoStop, break: true }, cyclingSettings: fixed,
        diagnostics: { entries: [], counts: {}, processed: 0 } };
      await (await this.open()).saveDraft(active); this.active = active;
      this.observation = new GpsObservationSession(undefined, undefined); return active;
    });
  }
  ingest(raws: RawLocationObservation[], appState = 'unknown') {
    return this.serialized(async () => {
      const current = await this.restore(); if (!current || current.endedAt) return current;
      let active = current;
      const counts = { ...(active.diagnostics?.counts ?? {}) };
      const inputs = this.observation!.ingest(raws, counts, appState, Date.parse(active.startedAt));
      const previousEvents = active.events?.length ?? 0;
      const persisted = [];
      for (const input of inputs) {
        active = detectStop(active, input.point, 'live-observation', input.window, CYCLING_PROFILE.distance.maxSpeedMetersPerSecond) as CyclingDraft;
        if (input.persist) persisted.push(input.point);
      }
      active = { ...active, points: [...active.points, ...persisted],
        diagnostics: { ...active.diagnostics!, counts: { ...active.diagnostics!.counts,
          ...Object.fromEntries(Object.entries(counts).filter(([key]) => key.startsWith('GPS_OBS_'))) } }, updatedAt: new Date().toISOString() };
      active.distanceMeters = effectiveDistance(active, CYCLING_PROFILE.distance);
      // Retain the newest cumulative RAM snapshot if a checkpoint fails.
      this.active = active;
      if (persisted.length || (active.events?.length ?? 0) !== previousEvents || this.pending) {
        this.pending = active;
        await (await this.open()).saveDraft(active); this.pending = null;
      }
      return active;
    });
  }
  pause(paused: boolean, at: number) {
    return this.serialized(async () => {
      const active = await this.restore(); if (!active || active.endedAt) return active;
      let updated = transition(active, paused ? 'BREAK' : 'RUNNING', at, 'user') as CyclingDraft;
      updated = { ...updated, distanceMeters: effectiveDistance(updated, CYCLING_PROFILE.distance) };
      await (await this.open()).saveDraft(updated); this.active = updated; return updated;
    });
  }
  prepareFinish(at: string) {
    return this.serialized(async () => {
      const active = await this.restore(); if (!active) return null;
      if (active.endedAt) return active;
      const pending = this.observation?.latestPoint;
      const end = Date.parse(at);
      if (!Number.isFinite(end) || end < Date.parse(active.startedAt)) throw Error('終了時刻が不正です');
      const points = pending && pending.timestamp <= end && this.observation!.gate.accept(pending.timestamp, true)
        ? [...active.points, pending] : active.points;
      const frozen = { ...active, points, endedAt: at, updatedAt: at };
      frozen.distanceMeters = effectiveDistance(frozen, CYCLING_PROFILE.distance);
      this.active = frozen; this.pending = frozen;
      await (await this.open()).saveDraft(frozen); this.pending = null; return frozen;
    });
  }
  finish() {
    return this.serialized(async () => {
      const active = await this.restore(); if (!active) return null;
      if (!active.endedAt) throw Error('保存前に計測終了を確定してください');
      await (await this.open()).saveDraft(active);
      const saved = await (await this.open()).complete(active as RunRecord);
      this.active = null; this.observation = null; this.pending = null; return saved;
    });
  }
  get currentState() { return this.active ? stateOf(this.active) : null; }
  get latestPoint() { return this.observation?.latestPoint ? { ...this.observation.latestPoint } : null; }
}
