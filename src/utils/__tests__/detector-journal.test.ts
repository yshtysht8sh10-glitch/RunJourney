import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { ActiveRun } from '@/types/run';
import { RunRepository } from '@/repositories/run-repository';
import AsyncStorage from '@/test/sqlite-fixture';
import { DetectorJournal, DetectorJournalRecorder, detectorJournalAllowed } from '@/services/detector-journal';
import { journalDecode, journalEncode, JournalRecord, replayDetectorJournal } from '@/domain/detector-journal';
import { effectiveRun, timeModel } from '@/utils/run-model';
import { RawLocationObservation } from '@/utils/gps-observation';

jest.mock('expo-application', () => ({ applicationId: 'app.runjourney.mobile.test' }));
jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: {
  detectorJournalOpen: jest.fn(async () => 'synthetic'), detectorJournalOffer: jest.fn(() => true), detectorJournalStop: jest.fn(),
} }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const native = require('../../../modules/run-announcer').default;
const base = (): ActiveRun => ({ id: 'synthetic-only', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '',
  points: [], events: [], distanceMeters: 0, features: { autoStop: true, break: true } });
const fix = (timestamp: number, latitude = 35): RawLocationObservation => ({ timestamp, latitude, longitude: 139, speed: 0, accuracy: 5, receivedAt: timestamp + 15 });
let records: JournalRecord[];
let priorOS: typeof Platform.OS;
beforeAll(() => { priorOS = Platform.OS; Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }); });
afterAll(() => { Object.defineProperty(Platform, 'OS', { value: priorOS, configurable: true }); });
beforeEach(async () => {
  await RunRepository.clearActiveRun(); await AsyncStorage.clear(); jest.clearAllMocks();
  records = [];
  jest.spyOn(Date, 'now').mockReturnValue(100000);
  native.detectorJournalOffer.mockImplementation((text: string) => { records.push(journalDecode(text)); return true; });
});
afterEach(async () => { await RunRepository.clearActiveRun(); jest.restoreAllMocks(); });

async function exercise(mode: 'off' | 'on' | 'reject' | 'throw' | 'late-reject') {
  await RunRepository.saveActiveRun(base());
  if (mode !== 'off') await DetectorJournal.arm();
  if (mode === 'reject') native.detectorJournalOffer.mockReturnValue(false);
  if (mode === 'throw') native.detectorJournalOffer.mockImplementation(() => { throw Error('synthetic bridge failure'); });
  if (mode === 'late-reject') native.detectorJournalOffer.mockImplementation((text: string) => { if (records.length >= 5) return false; records.push(journalDecode(text)); return true; });
  // Same timestamp duplicate, stale, reverse delivery order, invalid coordinates, non-finite time.
  await RunRepository.appendActiveObservations([fix(2000), fix(0), fix(1000), fix(1000), fix(NaN), fix(3000, 91)], 'active');
  await RunRepository.appendActiveObservations([fix(1000), ...[4000, 5000, 6000, 7000, 8000].map(t => fix(t))], 'background');
  await RunRepository.transition('BREAK', 9000);
  await RunRepository.appendActiveObservations([fix(10000), fix(11000)], 'background');
  await RunRepository.transition('RUNNING', 12000);
  await RunRepository.updateFinishGoal('synthetic-only', { kind: 'distance', meters: 1000 }, false);
  await RunRepository.appendActiveObservations([fix(13000), fix(14000, 35.00002), fix(15000, 35.00004)], 'active');
  // Explicit RAM-session reset, not pretending that a killed JS process continued recording.
  await RunRepository.saveActiveRun((await RunRepository.getActiveRun())!);
  await RunRepository.appendActiveObservations([fix(15000), fix(16000, 35.00006)], 'active');
  await RunRepository.prepareFinish(new Date(17000).toISOString());
  return (await RunRepository.finishActiveRun(new Date(17000).toISOString()))!;
}

test('ON/OFF and bridge rejection/throw preserve identical GPS, transitions, history, time and distance', async () => {
  const off = await exercise('off');
  for (const mode of ['on', 'reject', 'throw', 'late-reject'] as const) {
    records = [];
    await RunRepository.clearActiveRun(); await AsyncStorage.clear();
    const result = await exercise(mode);
    expect(result).toEqual(off);
    expect(JSON.stringify(effectiveRun(result))).toEqual(JSON.stringify(effectiveRun(off)));
    expect(timeModel(result)).toEqual(timeModel(off));
    expect(await RunRepository.getRun(result.id)).toEqual(result);
  }
});

test('replay reproduces current v4 across batch arrival order, rejected inputs, BREAK/settings/reset/END', async () => {
  await exercise('on');
  const replay = replayDetectorJournal(records);
  expect(replay).toEqual({ complete: true, batches: 5, inputs: 19, evaluations: 14, mismatches: [] });
  expect(records.find(r => r.kind === 'INPUT')!.data.raws.map((r: RawLocationObservation) => r.timestamp))
    .toEqual([2000, 0, 1000, 1000, NaN, 3000]);
});

test.each(['INPUT', 'ADMISSION', 'OUTPUT', 'BATCH_END', 'BOUNDARY', 'END'])('missing %s is incomplete even if sequences are renumbered', async kind => {
  await exercise('on');
  const dropped = records.findIndex(r => r.kind === kind);
  const damaged = records.filter((_, i) => i !== dropped).map((r, seq) => ({ ...r, seq }));
  expect(replayDetectorJournal(damaged).complete).toBe(false);
});

test('reordered batches, duplicate output, changed settings and false END totals are rejected', async () => {
  await exercise('on');
  const first = records.findIndex(r => r.kind === 'INPUT');
  const second = records.findIndex((r, i) => i > first && r.kind === 'INPUT');
  const reorder = [...records]; [reorder[first], reorder[second]] = [reorder[second], reorder[first]];
  expect(replayDetectorJournal(reorder).complete).toBe(false);
  const output = records.find(r => r.kind === 'OUTPUT')!;
  expect(replayDetectorJournal([...records.slice(0, 4), output, ...records.slice(4)]).complete).toBe(false);
  const changed = journalDecode(journalEncode(records)) as JournalRecord[];
  changed.at(-1)!.data.inputs++;
  expect(replayDetectorJournal(changed).complete).toBe(false);
  changed[0].data.run.features.autoStop = false;
  expect(replayDetectorJournal(changed).complete).toBe(false);
});

test('process restart/no END and recording OFF mid RUN never claim complete', async () => {
  await RunRepository.saveActiveRun(base()); await DetectorJournal.arm();
  await RunRepository.appendActiveObservations([fix(0)], 'active');
  DetectorJournal.stop();
  await RunRepository.appendActiveObservations([fix(5000)], 'active');
  await RunRepository.finishActiveRun(new Date(6000).toISOString());
  expect(replayDetectorJournal(records).complete).toBe(false);
});

test('default OFF skips serialization/native handoff; forbidden build cannot arm', async () => {
  const offer = jest.fn(); const open = jest.fn(); const stop = jest.fn();
  const disabled = new DetectorJournalRecorder({ open, offer, stop }, () => false);
  const hostile = new Proxy({} as ActiveRun, { get: () => { throw Error('must not inspect RUN'); } });
  disabled.begin(hostile); disabled.input(hostile, [], 'unknown'); disabled.batchEnd(hostile); disabled.boundary('test', hostile); disabled.end(hostile); disabled.stop();
  await disabled.arm();
  expect(offer).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  expect(detectorJournalAllowed()).toBe(true);
});

test('non-finite GPS values round-trip without becoming null', () => {
  const values = [NaN, Infinity, -Infinity, null, 0];
  expect(journalDecode(journalEncode(values))).toEqual(values);
});

test('armed before RUN start records START even without delivered GPS, and STOP remains replayable', async () => {
  await DetectorJournal.arm('synthetic-build');
  await RunRepository.saveActiveRun(base());
  await RunRepository.transition('BREAK', 1000);
  await RunRepository.finishActiveRun(new Date(2000).toISOString());
  expect(records[0].kind).toBe('START'); expect(records[0].data.buildGitHash).toBe('synthetic-build');
  expect(replayDetectorJournal(records)).toEqual({ complete: true, batches: 0, inputs: 0, evaluations: 0, mismatches: [] });
});

test('OFF while asynchronous arming prevents delayed re-enabling', async () => {
  let ready!: (id: string) => void;
  const stop = jest.fn(); const offer = jest.fn(() => true);
  const recorder = new DetectorJournalRecorder({ open: () => new Promise(resolve => { ready = resolve; }), stop, offer }, () => true);
  const armed = recorder.arm(); recorder.stop(); ready('synthetic'); await armed;
  recorder.begin(base()); expect(offer).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalled();
});

test('END handoff failure remains INCOMPLETE instead of showing seal pending', async () => {
  native.detectorJournalOffer.mockImplementation((text: string) => journalDecode(text).kind !== 'END');
  await DetectorJournal.arm(); await RunRepository.saveActiveRun(base());
  await RunRepository.finishActiveRun(new Date(2000).toISOString());
  expect(DetectorJournal.status).toBe('INCOMPLETE');
});

test('actual JS application-ID gate excludes Production, pace, debug and iOS', () => {
  for (const id of ['app.runjourney.mobile', 'app.runjourney.mobile.pace', 'app.runjourney.mobile.debug', null]) {
    Object.defineProperty(Application, 'applicationId', { value: id, configurable: true });
    expect(detectorJournalAllowed()).toBe(false);
  }
  Object.defineProperty(Application, 'applicationId', { value: 'app.runjourney.mobile.test', configurable: true });
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true }); expect(detectorJournalAllowed()).toBe(false);
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
});

test('95-minute capture closes while the same RUN continues to 150 minutes in SQLite',async()=>{
 let mono=0;
 const timer=jest.spyOn(performance,'now').mockImplementation(()=>mono);
 try {
  await RunRepository.saveActiveRun(base()); await DetectorJournal.arm('longrun-test');
  await RunRepository.appendActiveObservations([fix(0)],'active');
  mono=95*60000;
  await RunRepository.appendActiveObservations([fix(95*60000)],'background');
  expect(DetectorJournal.recording).toBe(false);
  expect(records.at(-1)?.data.reason).toBe('DIAGNOSTIC_LIMIT_95_MINUTES');
  const count=records.length;
  await RunRepository.appendActiveObservations([fix(150*60000)],'background');
  expect((await RunRepository.getActiveRun())?.endedAt).toBeUndefined();
  await RunRepository.flushCheckpoint();
  await RunRepository.prepareFinish(new Date(150*60000+1000).toISOString());
  const saved=await RunRepository.finishActiveRun(new Date(150*60000+1000).toISOString());
  expect(saved?.points.at(-1)?.timestamp).toBe(150*60000);
  expect(await RunRepository.getRun(saved!.id)).toEqual(saved);
  expect(records).toHaveLength(count);
  expect(replayDetectorJournal(records)).toMatchObject({complete:true,inputs:2,mismatches:[]});
 } finally {timer.mockRestore();}
});
