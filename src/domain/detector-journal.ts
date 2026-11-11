import { ActiveRun } from '@/types/run';
import { GpsObservationSession, RawLocationObservation, ObservationAdmission } from '@/utils/gps-observation';
import { detectStop } from '@/utils/run-model';

// Tagged non-finite values preserve rejected fixes; JSON null would change admission.
export const journalEncode = (value: unknown) => JSON.stringify(value, (_key, v) =>
  typeof v === 'number' && !Number.isFinite(v) ? { $number: String(v) } : v);
export const journalDecode = (value: string): any => JSON.parse(value, (_key, v) =>
  v && typeof v === 'object' && Object.keys(v).length === 1 && '$number' in v ? Number(v.$number) : v);
export const equalJournal = (a: unknown, b: unknown) => journalEncode(a) === journalEncode(b);

/** Only detector inputs, not history/pace/audio. Never attach this snapshot to RUN. */
export function detectorSnapshot(run: ActiveRun): ActiveRun {
  const entry = run.diagnostics?.entries.at(-1);
  const clean = entry ? { ...entry, pipeline: undefined, receivedAt: undefined } : undefined;
  return journalDecode(journalEncode({ id: run.id, startedAt: run.startedAt, endedAt: run.endedAt,
    createdAt: run.createdAt, updatedAt: '', points: [], distanceMeters: 0,
    features: run.features, events: run.events, detector: run.detector,
    finishGoal: run.finishGoal, finishAutoEnabled: run.finishAutoEnabled, goalChanges: run.goalChanges,
    diagnostics: run.diagnostics ? { processed: run.diagnostics.processed, counts: run.diagnostics.counts,
      entries: clean ? [clean] : [] } : undefined }));
}
export type JournalRecord = { seq: number; wallAt: number; monoAt: number; kind: string; data: any };
export type ReplayResult = { complete: boolean; batches: number; inputs: number; evaluations: number; mismatches: string[] };

/** Pure offline replay. Recorded batches retain arrival order; ingest performs its existing within-batch sort. */
export function createDetectorJournalReplay() {
  const result: ReplayResult = { complete: false, batches: 0, inputs: 0, evaluations: 0, mismatches: [] };
  let session: GpsObservationSession | undefined;
  let run: ActiveRun | undefined;
  let pending: ReturnType<GpsObservationSession['ingest']> | undefined;
  let index = 0, ended = false;
  let admissions: ObservationAdmission[] = [], admissionSeen = false;
  let ordinal = -1;
  const mismatch = (record: JournalRecord, reason: string) => { if (result.mismatches.length < 100) result.mismatches.push(`${record.seq}:${reason}`); };
  return { push(record: JournalRecord) {
    ordinal++;
    if (record.seq !== ordinal || ended) mismatch(record, 'SEQUENCE_OR_AFTER_END');
    const d = record.data;
    if (record.kind === 'START') {
      if (ordinal !== 0 || session) mismatch(record, 'DUPLICATE_START');
      if (d.schema !== 1 || d.algorithm !== 'v4-f1476f7') mismatch(record, 'UNSUPPORTED_BASELINE');
      session = new GpsObservationSession(d.lastPersisted, d.lastObserved); run = d.run;
    } else if (record.kind === 'FLUSH') {
      if (!session || pending || !session.gate.accept(d.timestamp, true)) mismatch(record, 'FLUSH_BOUNDARY');
    } else if (record.kind === 'BOUNDARY') {
      if (!run || pending) mismatch(record, 'BOUNDARY_WITHOUT_START_OR_IN_BATCH');
      // Explicit external state mutation, including manual BREAK/resume and settings.
      if (!equalJournal(run, d.before)) mismatch(record, 'BOUNDARY_PRE_STATE');
      run = d.after;
      if (d.reset) session = new GpsObservationSession(d.lastPersisted, d.lastObserved);
    } else if (record.kind === 'INPUT') {
      if (!session || !run || pending) { mismatch(record, 'INPUT_BOUNDARY'); return; }
      if (!equalJournal(run, d.before)) mismatch(record, 'UNRECORDED_STATE_CHANGE');
      const counts = { ...(run.diagnostics?.counts ?? {}) };
      admissions = []; admissionSeen = false;
      pending = session.ingest(d.raws as RawLocationObservation[], counts, d.appState, Date.parse(run.startedAt), entry => admissions.push(entry));
      if (run.diagnostics) run = { ...run, diagnostics: { ...run.diagnostics, counts } };
      result.inputs += d.raws.length; result.batches++; index = 0;
    } else if (record.kind === 'ADMISSION') {
      if (!pending || admissionSeen || !equalJournal(admissions, d.entries)) mismatch(record, 'INPUT_ADMISSION');
      admissionSeen = true;
    } else if (record.kind === 'OUTPUT') {
      const accepted = pending?.[index++];
      if (!accepted || !run || !admissionSeen) { mismatch(record, 'OUTPUT_WITHOUT_INPUT'); return; }
      if (!equalJournal(accepted, d.input)) mismatch(record, 'ADMISSION_ORDER_WINDOW_OR_PERSIST');
      // Detector's only wall-clock field is diagnostic receivedAt; excluded by snapshot.
      run = detectorSnapshot(detectStop(run, accepted.point, 'live-observation', accepted.window));
      if (!equalJournal(run, d.after)) mismatch(record, 'DETECTOR_OUTPUT');
      result.evaluations++;
    } else if (record.kind === 'BATCH_END') {
      if (!pending || !admissionSeen || index !== pending.length || !equalJournal(run, d.after)) mismatch(record, 'MISSING_OUTPUT_OR_BATCH_STATE');
      pending = undefined;
    } else if (record.kind === 'END') {
      if (!session || pending || !equalJournal(run, d.after)) mismatch(record, 'END_STATE_OR_OPEN_BATCH');
      if (d.inputs !== result.inputs || d.evaluations !== result.evaluations || d.batches !== result.batches) mismatch(record, 'END_TOTALS');
      ended = true;
    } else mismatch(record, 'UNKNOWN_RECORD');
  }, finish(): ReplayResult {
    if (!ended) result.mismatches.push('MISSING_END');
    result.complete = ended && result.mismatches.length === 0;
    return result;
  } };
}

export function replayDetectorJournal(records: JournalRecord[]): ReplayResult {
  const replay = createDetectorJournalReplay();
  records.forEach(record => replay.push(record));
  return replay.finish();
}
