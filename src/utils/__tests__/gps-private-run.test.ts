import fs from 'node:fs';
import native from '../../../modules/run-announcer';
import { parsePrivateInput, privateScenario, replayStatistics, distribution, type Decision } from '@/test/gps-private-input';
import { GpsBatchReplay } from '@/test/gps-batch-replay';
import { ingestLocationBatch } from '@/tasks/location-task';
import { RunRepository } from '@/repositories/run-repository';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { createPaceWorkout, DEFAULT_PACE_SETTINGS } from '@/domain/pace-workout';
import { resetNative } from '@/test/native-driver';
import { database } from '@/repositories/database';
import { diagnosticLog } from '@/services/diagnostic-log';
import { summarizeStopLatency } from '@/domain/stop-latency';
import type { ActiveRun } from '@/types/run';
jest.mock('@/utils/build', () => ({ isStandaloneTest: () => true }));
jest.mock('@/services/diagnostic-log', () => ({ diagnosticLog: jest.fn() }));
jest.mock('../../../modules/run-announcer', () => ({ __esModule:true, default: {
  pacePeriodicVersion: () => 1, pacePeriodicState: jest.fn(), notifyBatch: jest.fn(), updateDistance: jest.fn(), stop: jest.fn(),
} }));

test('isolated private runner processes only received input and writes coordinate-free aggregates', async () => {
  resetNative(); jest.clearAllMocks();
  const file = process.env.RUNJOURNEY_PRIVATE_INPUT;
  if (file && fs.statSync(file).size > 32*1024*1024) throw Error('REPLAY_INPUT_LIMIT');
  const input = file ? parsePrivateInput(fs.readFileSync(file, 'utf8')) : privateScenario(Number(process.env.RUNJOURNEY_PRIVATE_MINUTES ?? 6));
  const replay = new GpsBatchReplay(input.batches, input.startedAt);
  let now = input.startedAt, cursor: { acceptedThrough: number; activeFromMs: number } | undefined;
  let received = 0, slots = 0; const ids = new Set<string>(), quality: Record<string, number> = {};
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(native.pacePeriodicState!).mockImplementation(() => JSON.stringify(cursor ?? null));
  jest.mocked(native.notifyBatch!).mockImplementation(text => {
    const batch = JSON.parse(text);
    if (batch.paceSchedule?.enabled && !cursor) cursor = { acceptedThrough:0, activeFromMs:input.startedAt };
    for (const n of batch.notices) {
      const s = n.data?.pacePeriodicSnapshot; if (!s) continue;
      if (ids.has(n.id) || s.slot !== cursor!.acceptedThrough+1 || s.endAt > now || s.endAt !== input.startedAt+s.slot*60000) throw Error('PACE_RECEIPT_OR_BOUNDARY_MISMATCH');
      ids.add(n.id); cursor!.acceptedThrough=s.slot; slots++; quality[s.quality]=(quality[s.quality]??0)+1;
    }
  });
  const run: ActiveRun = { id:'PC-PRIVATE-ONLY', startedAt:new Date(now).toISOString(), createdAt:'', updatedAt:'', points:[], distanceMeters:0,
    events:[], features:{autoStop:true,break:true}, diagnostics:{entries:[],counts:{},processed:0},
    paceWorkout:createPaceWorkout({...DEFAULT_PACE_SETTINGS,enabled:true,voice:true,voiceIntervalSec:60,distanceKm:200},now) };
  const begin = performance.now(), cpu = process.cpuUsage(), rss = [process.memoryUsage().rss], delays: number[] = [];
  try {
    await RunRepository.saveActiveRun(run); await VoiceAnnouncement.started(run);
    let batch;
    while ((batch=replay.step())) {
      now=replay.now; received+=batch.locations.length;
      delays.push(...batch.locations.map(p=>now-p.timestamp));
      await ingestLocationBatch(batch.locations,now,batch.appState);
      if(received%100===0)rss.push(process.memoryUsage().rss);
    }
    await RunRepository.flushCheckpoint();
    const saved=await RunRepository.finishActiveRun(new Date(now).toISOString());
    if (!saved || (await (await database()).list(true)).length !== 1) throw Error('ISOLATION_OR_SAVE_FAILED');
    if (!file && slots < Math.floor((now-input.startedAt)/60000)-1) throw Error('PACE_LONG_RUN_SLOT_GAP');
    const rows=jest.mocked(diagnosticLog).mock.calls.filter(([type,,status])=>type==='STOP_PIPELINE'&&['STOP_CONFIRMED','RESUME_CONFIRMED'].includes(status));
    const decisions: Decision[]=rows.map(([, ,type,data])=>{
      const d=data as { timestamp:number; pipeline:{finishedAt:number} };
      return {type:type as Decision['type'],effectiveAt:d.timestamp,availableAt:d.pipeline.finishedAt};
    });
    const cpuUsed=process.cpuUsage(cpu);
    const report={schema:1,mode:file?'private-replay':'synthetic',virtualMinutes:(now-input.startedAt)/60000,inputFixes:received,batches:input.batches.length,
      savedGpsPoints:saved.points.length,paceSlots:slots,paceSnapshotQuality:quality,inputDeliveryDelayMs:distribution(delays),
      decisions:decisions.length,truth:replayStatistics(input.stops,decisions),realMs:performance.now()-begin,
      pipelineStages:summarizeStopLatency(jest.mocked(diagnosticLog).mock.calls.map(([type,id,status,data])=>({type,id,status,data:data as Record<string,unknown>,loggedAt:0})),run.id).stages,
      cpuMs:{user:cpuUsed.user/1000,system:cpuUsed.system/1000},sampledPeakRssBytes:Math.max(...rss,process.memoryUsage().rss),
      isolation:'PC in-memory SQLite only',limitations:['fake cursor is not native durable ACK or playback','sampled RSS is not absolute peak','no phone battery/temperature/Doze measurement','unmatched transitions are not automatically false detections with incomplete labels']};
    if(process.env.RUNJOURNEY_PRIVATE_REPORT)fs.writeFileSync(process.env.RUNJOURNEY_PRIVATE_REPORT,JSON.stringify(report,null,2),{flag:'wx'});
  } finally {clock.mockRestore();}
},240000);
