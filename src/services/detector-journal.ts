import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { detectorSnapshot, journalDecode, journalEncode, createDetectorJournalReplay } from '@/domain/detector-journal';
import { ActiveRun } from '@/types/run';
import { RawLocationObservation, GpsObservationSession, ObservationAdmission } from '@/utils/gps-observation';

type Transport = { open(): Promise<string>; offer(payload: string): boolean; stop(): void };
export class DetectorJournalRecorder {
  private enabled = false;
  private started = false;
  private seq = 0;
  private inputs = 0;
  private evaluations = 0;
  private batches = 0;
  private last?: ActiveRun;
  private opening = false;
  private epoch = 0;
  private buildGitHash = 'unknown';
  status = 'OFF';
  maxHandoffMs = 0;
  private handoffs = new Uint32Array(2001);
  private handoffCount = 0;
  get handoffSummary() {
    const q=(p:number)=>{let n=0;const target=Math.ceil(this.handoffCount*p);for(let i=0;i<this.handoffs.length;i++){n+=this.handoffs[i];if(n>=target)return i/10;}return null;};
    return {count:this.handoffCount,p50:this.handoffCount?q(.5):null,p95:this.handoffCount?q(.95):null,max:this.maxHandoffMs,binMs:.1,overflowAtMs:200};
  }
  get recording() { return this.enabled && this.started; }
  constructor(private transport: Transport, private allowed: () => boolean) {}
  async arm(buildGitHash = 'unknown') {
    if (!this.allowed() || this.enabled || this.opening) return;
    this.opening = true;
    const epoch = ++this.epoch;
    try {
      await this.transport.open();
      if (epoch !== this.epoch) { this.transport.stop(); return; }
      this.enabled = true; this.started = false; this.seq = this.inputs = this.evaluations = this.batches = 0;
      this.buildGitHash = buildGitHash;
      this.last = undefined; this.maxHandoffMs = 0;this.handoffs.fill(0);this.handoffCount=0; this.status = 'ARMED';
    } catch { if (epoch === this.epoch) this.status = 'UNAVAILABLE'; }
    finally { this.opening = false; }
  }
  private emit(kind: string, data: () => unknown) {
    if (!this.enabled) return;
    const start = performance.now();
    try {
      if (!this.transport.offer(journalEncode({ seq: this.seq++, wallAt: Date.now(), monoAt: start, kind, data: data() }))) throw new Error('rejected');
    } catch { this.enabled = false; this.status = 'INCOMPLETE'; try { this.transport.stop(); } catch { /* diagnosis only */ } }
    const duration=performance.now()-start;this.maxHandoffMs=Math.max(this.maxHandoffMs,duration);
    this.handoffs[Math.min(2000,Math.max(0,Math.floor(duration*10)))]++;this.handoffCount++;
  }
  begin(run: ActiveRun, lastPersisted?: number, lastObserved?: number) {
    if (!this.enabled) return;
    if (this.started) { this.boundary('OBSERVATION_SESSION_INIT', run, true); return; }
    this.started = true; this.status = 'RECORDING';
    this.emit('START', () => {
      this.last = detectorSnapshot(run);
      return { schema: 1, algorithm: 'v4-f1476f7', sourceSHA: 'f1476f7947779b0fa4aeb28a054efd44255ef0c8', buildGitHash: this.buildGitHash,
        coverage: 'JS_SUBMITTED_ONLY', run: this.last, lastPersisted, lastObserved };
    });
  }
  input(run: ActiveRun, raws: RawLocationObservation[], appState: string) {
    if (!this.started) return;
    this.emit('INPUT', () => { this.inputs += raws.length; this.batches++; return { before: detectorSnapshot(run), raws, appState }; });
  }
  output(input: ReturnType<GpsObservationSession['ingest']>[number], run: ActiveRun) {
    if (!this.started) return;
    this.emit('OUTPUT', () => { this.evaluations++; return { input, after: detectorSnapshot(run) }; });
  }
  admission(entries: ObservationAdmission[]) { this.emit('ADMISSION', () => ({ entries })); }
  flush(timestamp: number) { if (this.started) this.emit('FLUSH', () => ({ timestamp })); }
  batchEnd(run: ActiveRun) {
    if (!this.started) return;
    this.emit('BATCH_END', () => { this.last = detectorSnapshot(run); return { after: this.last }; });
  }
  boundary(reason: string, after: ActiveRun, reset = false) {
    if (!this.started) {
      if (this.enabled && reason === 'SAVE_OR_RESTORE') this.begin(after, after.points.at(-1)?.timestamp, after.diagnostics?.counts.GPS_OBS_LAST_TIMESTAMP);
      return;
    }
    this.emit('BOUNDARY', () => {
      const before = this.last; this.last = detectorSnapshot(after);
      return { reason, before, after: this.last, reset, lastPersisted: after.points.at(-1)?.timestamp, lastObserved: after.diagnostics?.counts.GPS_OBS_LAST_TIMESTAMP };
    });
  }
  end(run: ActiveRun) {
    if (!this.started || !this.enabled) return;
    this.boundary('RUN_FINISH', run);
    if (!this.enabled) return;
    this.emit('END', () => ({ after: detectorSnapshot(run), inputs: this.inputs, evaluations: this.evaluations, batches: this.batches, maxHandoffMs: this.maxHandoffMs }));
    if (!this.enabled) return;
    this.enabled = false; this.status = 'SEALED_PENDING_VERIFICATION';
    try { this.transport.stop(); } catch { this.status = 'INCOMPLETE'; }
  }
  stop(force = false) {
    const wasEnabled = this.enabled;
    this.epoch++;
    this.enabled = false; this.started = false;
    if (wasEnabled) this.status = 'OFF_CAPTURE_INCOMPLETE';
    if (wasEnabled || this.opening || force && this.allowed()) try { this.transport.stop(); } catch { /* never fail RUN */ }
  }
}

export const detectorJournalAllowed = () => Platform.OS === 'android' && Application.applicationId === 'app.runjourney.mobile.test';
export const detectorJournalNative = () => {
  if (!detectorJournalAllowed()) throw new Error('Test only');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
};
export const DetectorJournal = new DetectorJournalRecorder({
  open: async () => { const native = detectorJournalNative(); if (!native.detectorJournalOpen) throw new Error('missing'); return native.detectorJournalOpen(); },
  offer: payload => detectorJournalNative().detectorJournalOffer?.(payload) === true,
  stop: () => { if (detectorJournalAllowed()) detectorJournalNative().detectorJournalStop?.(); },
}, detectorJournalAllowed);

/** Internal memory-only reader, never Share/Backup/console. Run only with capture OFF. */
export async function replayLocalDetectorJournal(id: string, legacy = false, readBudgetMs = Infinity) {
  const native = detectorJournalNative();
  const replay = createDetectorJournalReplay();
  let token: string | undefined;
  let recordsRead = 0, pages = 0, authenticatedRecords = 0, decryptions = 0;
  let firstPageMs: number | undefined;
  let readMs = 0;
  const started = performance.now();
  try {
    if (!legacy) token = await native.detectorJournalOpenReader!(id);
    for (;;) {
      const page = journalDecode(await (token
        ? native.detectorJournalNextPage!(token)
        : native.detectorJournalRead!(id, recordsRead)));
      const arrived = performance.now();
      readMs = arrived - started;
      firstPageMs ??= readMs;
      pages++;
      recordsRead += page.records.length;
      authenticatedRecords = page.authenticatedRecords;
      decryptions = legacy ? decryptions + authenticatedRecords : authenticatedRecords;
      for (const text of page.records) replay.push(journalDecode(text));
      const metrics = { pages, recordsRead, authenticatedRecords, decryptions, firstPageMs, readMs, totalMs: performance.now() - started };
      if (page.done) {
        const result = replay.finish();
        if (page.storageComplete !== true) { result.complete = false; result.mismatches.push('NATIVE_NOT_SEALED'); }
        return { ...result, ...metrics, storageComplete: page.storageComplete === true };
      }
      if (!page.records.length) throw new Error('Invalid page');
      if (metrics.totalMs >= readBudgetMs) return { ...metrics, complete: false, storageComplete: false, mismatches: ['READER_BUDGET'] };
    }
  } finally {
    if (token) await native.detectorJournalCloseReader!(token);
  }
}
