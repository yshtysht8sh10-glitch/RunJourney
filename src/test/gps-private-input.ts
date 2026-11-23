import type { LocationObject } from 'expo-location';
import type { ReplayBatch } from './gps-batch-replay';
export type StopTruth = { start: number; end: number; quality: 'good' | 'poor' };
export type ReplayInput = { schema: 1; startedAt: number; batches: ReplayBatch[]; stops?: StopTruth[] };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** All errors are fixed codes: never echo private coordinates or input text. */
export function parsePrivateInput(text: string): ReplayInput {
  if (Buffer.byteLength(text, 'utf8') > 32 * 1024 * 1024) throw Error('REPLAY_INPUT_LIMIT');
  let v: ReplayInput;
  try { v = JSON.parse(text); } catch { throw Error('REPLAY_INVALID_JSON'); }
  if (!v || v.schema !== 1 || !finite(v.startedAt) || !Array.isArray(v.batches) || !v.batches.length || v.batches.length > 20000) throw Error('REPLAY_INVALID_HEADER');
  let count = 0, last = v.startedAt;
  for (const b of v.batches) {
    if (!b || !finite(b.receivedAt) || b.receivedAt < last || !['active','background','inactive','unknown','extension'].includes(b.appState)
      || !Array.isArray(b.locations) || (count += b.locations.length) > 100000) throw Error('REPLAY_INVALID_BATCH');
    last = b.receivedAt;
    for (const p of b.locations) {
      if (!p || !finite(p.timestamp) || p.timestamp > b.receivedAt || !p.coords || !finite(p.coords.latitude) || !finite(p.coords.longitude)
        || !['accuracy','altitude','altitudeAccuracy','heading','speed'].every(k => p.coords[k as keyof LocationObject['coords']] === null || finite(p.coords[k as keyof LocationObject['coords']]))) throw Error('REPLAY_INVALID_FIX');
    }
  }
  if (v.stops !== undefined) {
    if (!Array.isArray(v.stops) || v.stops.length > 10000) throw Error('REPLAY_INVALID_TRUTH');
    let previous = v.startedAt;
    for (const s of v.stops) {
      if (!s || !finite(s.start) || !finite(s.end) || s.start < previous || s.end <= s.start || s.end > last || !['good','poor'].includes(s.quality)) throw Error('REPLAY_INVALID_TRUTH');
      previous = s.end;
    }
  }
  return v;
}

/** Ground truth is authored here, independently of the detector/GPS classifications. */
export function privateScenario(minutes: number): ReplayInput {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw Error('REPLAY_MINUTES_LIMIT');
  const startedAt = 1800000000000, batches: ReplayBatch[] = [], stops: StopTruth[] = [];
  const ranges = [[100,103],[200,208],[300,325],[450,480]];
  for (let cycle = 0; cycle < minutes * 60; cycle += 900) for (const [a,b] of ranges) {
    if (cycle + b <= minutes * 60) stops.push({ start: startedAt + (cycle+a)*1000, end: startedAt + (cycle+b)*1000, quality: a === 450 ? 'poor' : 'good' });
  }
  let meters = 0, random = 49, queued: LocationObject[] = [];
  for (let sec = 0; sec <= minutes * 60; sec++) {
    const phase = sec % 900, stopped = ranges.some(([a,b]) => phase >= a && phase < b);
    const speed = stopped ? 0 : phase >= 325 && phase < 355 ? .8 : 3.1;
    if (sec) meters += speed;
    if (sec > 900 && sec % 5 !== 0) continue;
    const poor = phase >= 450 && phase < 470, missing = phase >= 600 && phase < 610;
    random = (1664525 * random + 1013904223) >>> 0;
    const jitter = (random / 4294967296 - .5) * (poor ? 20 : .2);
    if (!missing) queued.push({ timestamp: startedAt+sec*1000, mocked: true,
      coords: { latitude: 35+(meters+jitter)/111195, longitude:139, accuracy:poor?60:5, speed, altitude:null, altitudeAccuracy:null, heading:null } });
    if (phase >= 700 && phase < 720) continue;
    if (queued.length) batches.push({ receivedAt: startedAt+sec*1000, appState: phase < 30 ? 'active' : 'background', locations: queued });
    queued = [];
  }
  return { schema: 1, startedAt, batches, stops };
}

/** Clean five-second GPS, no detector-derived truth or real location data. */
export function continuousScenario(minutes: number): ReplayInput {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw Error('REPLAY_MINUTES_LIMIT');
  const startedAt=1800000000000;
  return {schema:1,startedAt,stops:[],batches:Array.from({length:minutes*12+1},(_,i)=>({
    receivedAt:startedAt+i*5000,appState:'background' as const,locations:[{timestamp:startedAt+i*5000,mocked:true,
      coords:{latitude:35+i*15/111195,longitude:139,accuracy:5,speed:3,altitude:null,altitudeAccuracy:null,heading:null}}]}))};
}

export function distribution(values: number[]) {
  const sorted = [...values].sort((a,b) => a-b);
  const q = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length*p)-1] : null;
  return { count: sorted.length, p50: q(.5), p95: q(.95), max: sorted.at(-1) ?? null };
}
export type Decision = { type: 'STOP_CONFIRMED' | 'RESUME_CONFIRMED'; effectiveAt: number; availableAt: number };
export function replayStatistics(stops: StopTruth[] | undefined, decisions: Decision[]) {
  if (!stops) return { truthProvided: false, accuracy: null };
  const used = new Set<Decision>(), stopDelays: number[] = [], resumeDelays: number[] = [];
  let missed = 0, missedResumes = 0;
  const durations: Record<string, { intended: number; detected: number }> = {};
  const byQuality: Record<string, number[]> = { good: [], poor: [] };
  stops.forEach((truth, index) => {
    const duration = String((truth.end-truth.start)/1000);
    const group = durations[duration] ??= { intended: 0, detected: 0 }; group.intended++;
    const stop = decisions.find(d => !used.has(d) && d.type === 'STOP_CONFIRMED' && d.availableAt >= truth.start && d.availableAt < truth.end);
    if (!stop) { missed++; return; }
    used.add(stop); group.detected++; const delay = stop.availableAt-truth.start; stopDelays.push(delay); byQuality[truth.quality].push(delay);
    const resume = decisions.find(d => !used.has(d) && d.type === 'RESUME_CONFIRMED' && d.availableAt >= truth.end && d.availableAt < (stops[index+1]?.start ?? Infinity));
    if (resume) { used.add(resume); resumeDelays.push(resume.availableAt-truth.end); } else missedResumes++;
  });
  return { truthProvided: true, intendedStops: stops.length, detectedStops: stopDelays.length, missedStops: missed, missedResumesAfterDetectedStops: missedResumes, byDurationSeconds: durations,
    unmatchedStops: decisions.filter(d => d.type === 'STOP_CONFIRMED' && !used.has(d)).length,
    unmatchedResumes: decisions.filter(d => d.type === 'RESUME_CONFIRMED' && !used.has(d)).length,
    stopDelayMs: distribution(stopDelays), resumeDelayMs: distribution(resumeDelays),
    qualityStopDelayMs: { good: distribution(byQuality.good), poor: distribution(byQuality.poor) } };
}
