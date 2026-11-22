import type { LocationObject } from 'expo-location';
/** Imported only by PC tests, never by app routes. No device DB, GPS or native audio. */
export class GpsSimulator {
  now: number; paused = false; second = -1;
  readonly timeline: { at: number; kind: string; speed: number }[] = [];
  private meters = 0; private queued: LocationObject[] = []; private random: number;
  constructor(readonly seed = 49, readonly startedAt = 1_800_000_000_000) { this.now = startedAt; this.random = seed >>> 0; }
  private rng() { this.random = (1664525 * this.random + 1013904223) >>> 0; return this.random / 4294967296; }
  step(): LocationObject[] {
    if(this.paused) return [];
    const sec = ++this.second; this.now = this.startedAt + sec * 1000;
    const cycle = sec % 900;
    const stop = cycle >= 300 && cycle < 325, slow = cycle >= 325 && cycle < 355;
    const poor = cycle >= 450 && cycle < 470, missing = cycle >= 600 && cycle < 610;
    const batch = cycle >= 700 && cycle < 720;
    const speed = stop ? 0 : slow ? .8 : 3.1;
    this.meters += speed;
    const kind = stop ? 'STOP' : slow ? 'SLOW' : poor ? 'POOR_ACCURACY_JITTER' : missing ? 'MISSING' : batch ? 'BATCH_DELAY' : 'RUN';
    if(this.timeline.at(-1)?.kind !== kind) this.timeline.push({at:this.now,kind,speed});
    const jitter = (this.rng() - .5) * (poor ? 20 : stop ? .2 : .1);
    if (!missing) this.queued.push({ timestamp: this.now, coords: { latitude: 35 + (this.meters+jitter)/111195, longitude:139,
      accuracy: poor ? 60 : 5, altitude:null, altitudeAccuracy:null, heading:null, speed }, mocked:true });
    if(batch) return [];
    const result = this.queued; this.queued = []; return result;
  }
}
