import { LocationPoint } from '@/types/run';
import { RUN_CONTROL } from '@/utils/run-model';

export const OBSERVATION_WINDOW_MS = 10_000;
export const GPS_PERSIST_INTERVAL_MS = 5_000;
export type RawLocationObservation = Omit<LocationPoint, 'accuracy' | 'speed'> & {
  accuracy: number | null; speed: number | null; receivedAt: number;
};

/** Event-time window; quality is deliberately not an admission criterion. */
export class RollingObservationBuffer {
  private observations: RawLocationObservation[] = [];
  private watermark = -Infinity;
  constructor(private windowMs = OBSERVATION_WINDOW_MS, private capacity = 256) {}
  add(observation: RawLocationObservation): boolean {
    if (!Number.isFinite(observation.timestamp) || observation.timestamp < 0) return false;
    this.watermark = Math.max(this.watermark, observation.timestamp);
    this.observations = this.observations.filter(p => p.timestamp >= this.watermark - this.windowMs);
    if (observation.timestamp < this.watermark - this.windowMs || this.observations.some(p => p.timestamp === observation.timestamp)) return false;
    this.observations = [...this.observations, { ...observation }].sort((a, b) => a.timestamp - b.timestamp).slice(-this.capacity);
    return true;
  }
  getRecent(windowMs = this.windowMs, now = this.watermark): RawLocationObservation[] {
    return this.observations.filter(p => p.timestamp >= now - Math.min(windowMs, this.windowMs) && p.timestamp <= now).map(p => ({ ...p }));
  }
  getLatest() { const latest = this.observations.at(-1); return latest ? { ...latest } : null; }
  clear() { this.observations = []; this.watermark = -Infinity; }
}

export class GpsPersistenceGate {
  constructor(private lastTimestamp: number | undefined, private intervalMs = GPS_PERSIST_INTERVAL_MS) {}
  accept(timestamp: number, flush = false): boolean {
    if (!Number.isFinite(timestamp) || timestamp < 0 || this.lastTimestamp !== undefined && timestamp <= this.lastTimestamp) return false;
    if (!flush && this.lastTimestamp !== undefined && timestamp - this.lastTimestamp < this.intervalMs) return false;
    this.lastTimestamp = timestamp;
    return true;
  }
}

const prefix = 'GPS_OBS_';
const key = (name: string) => `${prefix}${name}`;
export function incrementObservationCount(counts: Record<string, number>, name: string, value = 1) {
  counts[key(name)] = (counts[key(name)] ?? 0) + value;
}
function sample(counts: Record<string, number>, name: string, value: number, histogram = false) {
  if (!Number.isFinite(value) || value < 0) return;
  incrementObservationCount(counts, `${name}_COUNT`);
  incrementObservationCount(counts, `${name}_SUM`, value);
  counts[key(`${name}_MIN`)] = Math.min(counts[key(`${name}_MIN`)] ?? value, value);
  counts[key(`${name}_MAX`)] = Math.max(counts[key(`${name}_MAX`)] ?? value, value);
  // Bounded 100ms bins; 60s+ is an overflow bin. No raw coordinate log.
  if (histogram) incrementObservationCount(counts, `${name}_BIN_${Math.min(600, Math.floor(value / 100))}`);
}

export function observationToPoint(raw: RawLocationObservation): LocationPoint {
  const { receivedAt: _receivedAt, ...point } = raw;
  return { ...point, accuracy: raw.accuracy ?? undefined, speed: raw.speed ?? undefined };
}

/** RAM lifetime is one JS session. Persist aggregates with existing diagnostic counts. */
export class GpsObservationSession {
  readonly buffer = new RollingObservationBuffer();
  readonly gate: GpsPersistenceGate;
  private lastObservation: number;
  private lastCallback?: number;
  private lastAppState?: string;
  latestPoint: LocationPoint | null = null;
  constructor(lastPersisted: number | undefined, lastObserved: number | undefined) {
    this.gate = new GpsPersistenceGate(lastPersisted);
    this.lastObservation = Math.max(lastPersisted ?? -Infinity, lastObserved ?? -Infinity);
  }
  ingest(raws: RawLocationObservation[], counts: Record<string, number>, appState: string, startedAt: number) {
    appState = ['active', 'background', 'inactive'].includes(appState) ? appState : 'unknown';
    incrementObservationCount(counts, 'CALLBACKS');
    incrementObservationCount(counts, `APP_${['active', 'background', 'inactive'].includes(appState) ? appState : 'unknown'}`);
    if (raws.length > 1) incrementObservationCount(counts, 'BATCH_CALLBACKS');
    counts[key('MAX_BATCH_SIZE')] = Math.max(counts[key('MAX_BATCH_SIZE')] ?? 0, raws.length);
    const receivedAt = raws[0]?.receivedAt;
    if (receivedAt !== undefined && Number.isFinite(receivedAt)) {
      if (this.lastCallback !== undefined) {
        const gap = receivedAt - this.lastCallback;
        sample(counts, 'CALLBACK_INTERVAL', gap, true);
        if (gap > 5000) incrementObservationCount(counts, 'CALLBACK_GAPS_OVER_5S');
      }
      this.lastCallback = receivedAt;
    }
    const accepted: { point: LocationPoint; persist: boolean }[] = [];
    for (const raw of [...raws].sort((a, b) => a.timestamp - b.timestamp)) {
      incrementObservationCount(counts, 'DELIVERED');
      if (!Number.isFinite(raw.timestamp) || raw.timestamp < startedAt || raw.timestamp <= this.lastObservation) {
        incrementObservationCount(counts, 'STALE_OR_INVALID'); continue;
      }
      if (Number.isFinite(this.lastObservation)) {
        sample(counts, 'INTERVAL', raw.timestamp - this.lastObservation, true);
        if (this.lastAppState === appState) sample(counts, `INTERVAL_${appState}`, raw.timestamp - this.lastObservation, true);
      }
      this.lastObservation = raw.timestamp;
      this.lastAppState = appState;
      counts[key('LAST_TIMESTAMP')] = raw.timestamp;
      incrementObservationCount(counts, 'COUNT');
      sample(counts, 'DELIVERY_LAG', raw.receivedAt - raw.timestamp);
      if (raw.accuracy !== null) sample(counts, 'ACCURACY', raw.accuracy);
      if (raw.accuracy === null || !Number.isFinite(raw.accuracy) || raw.accuracy < 0 || raw.accuracy > RUN_CONTROL.accuracy) incrementObservationCount(counts, 'ACCURACY_POOR_OR_MISSING');
      if (raw.speed !== null && Number.isFinite(raw.speed) && raw.speed >= 0) incrementObservationCount(counts, 'SPEED_AVAILABLE');
      this.buffer.add(raw);
      counts[key('BUFFER_SIZE')] = this.buffer.getRecent().length;
      counts[key('BUFFER_MAX')] = Math.max(counts[key('BUFFER_MAX')] ?? 0, counts[key('BUFFER_SIZE')]);
      if (!Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude) || Math.abs(raw.latitude) > 90 || Math.abs(raw.longitude) > 180) {
        incrementObservationCount(counts, 'INVALID_COORDINATES'); continue;
      }
      this.latestPoint = observationToPoint(raw);
      accepted.push({ point: this.latestPoint, persist: this.gate.accept(raw.timestamp) });
    }
    this.lastAppState = appState;
    return accepted;
  }
}

export function observationDiagnosticSummary(counts: Record<string, number>, persistedCount: number) {
  if (!counts[key('CALLBACKS')]) return null;
  const summary = (name: string) => {
    const count = counts[key(`${name}_COUNT`)] ?? 0;
    const quantile = (q: number) => {
      let cumulative = 0;
      for (let bin = 0; bin <= 600; bin++) {
        cumulative += counts[key(`${name}_BIN_${bin}`)] ?? 0;
        if (cumulative >= Math.ceil(count * q)) return bin === 600 ? '>=60000ms' : `${bin * 100}–${bin * 100 + 99}ms`;
      }
      return null;
    };
    return count ? { count, min: counts[key(`${name}_MIN`)], max: counts[key(`${name}_MAX`)], average: counts[key(`${name}_SUM`)] / count,
      ...(name.includes('INTERVAL') ? { median: quantile(.5), p90: quantile(.9), p95: quantile(.95) } : {}) } : null;
  };
  return { observationCount: counts[key('COUNT')] ?? 0, deliveredCount: counts[key('DELIVERED')] ?? 0, persistedGpsCount: persistedCount,
    intervalsMs: summary('INTERVAL'), callbackIntervalsMs: summary('CALLBACK_INTERVAL'), deliveryLagMs: summary('DELIVERY_LAG'),
    accuracyMeters: summary('ACCURACY'), accuracyPoorOrMissing: counts[key('ACCURACY_POOR_OR_MISSING')] ?? 0,
    speedAvailableCount: counts[key('SPEED_AVAILABLE')] ?? 0, callbackGapsOver5s: counts[key('CALLBACK_GAPS_OVER_5S')] ?? 0,
    batchCallbacks: counts[key('BATCH_CALLBACKS')] ?? 0, maxBatchSize: counts[key('MAX_BATCH_SIZE')] ?? 0,
    bufferSize: counts[key('BUFFER_SIZE')] ?? 0, maxBufferSize: counts[key('BUFFER_MAX')] ?? 0,
    runtimeSegments: counts[key('SEGMENTS')] ?? 0,
    appStateCallbacks: { active: counts[key('APP_active')] ?? 0, background: counts[key('APP_background')] ?? 0, inactive: counts[key('APP_inactive')] ?? 0, unknown: counts[key('APP_unknown')] ?? 0 },
    intervalsByAppStateMs: { active: summary('INTERVAL_active'), background: summary('INTERVAL_background'), inactive: summary('INTERVAL_inactive'), unknown: summary('INTERVAL_unknown') },
    measurementNotice: '100ms histogram quantiles; >=60s overflow. AppState is not screen state. RAM restart loses uncheckpointed samples; intervals may cross restart. Record battery %, screen-off times and test conditions manually.' };
}
