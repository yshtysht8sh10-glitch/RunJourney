import { ActiveRun, RunRecord } from '@/types/run';
import { legacyDetectStop } from '@/utils/legacy-auto-stop-audit';
import { detectStop, detectStopV3, RUN_CONTROL, stateOf } from '@/utils/run-model';
import { distanceBetween } from '@/utils/distance';
import { observationDiagnosticSummary } from '@/utils/gps-observation';

// Replays are explicitly labelled simulations. They never change the saved run,
// and cannot prove what happened between fixes or whether a person actually stopped.
export function diagnosticReport(run: ActiveRun, buildHash: string) {
  let replay: ActiveRun = { ...run, endedAt: undefined, points: [], events: [], detector: undefined,
    stopOverrides: undefined, diagnostics: { entries: [], counts: {}, processed: 0 } };
  let v3: ActiveRun = { ...replay };
  let legacy: ActiveRun = { ...replay, diagnostics: undefined };
  const quality = { accuracyPoor: 0, speedMissing: 0, intervalsOver15s: 0, maxIntervalMs: 0, legacyCandidateStarts: 0, legacyCandidateLosses: 0 };
  const legacyLossReasons: Record<string, number> = {};
  run.points.forEach((point, index) => {
    if (point.accuracy === undefined || point.accuracy < 0 || point.accuracy > RUN_CONTROL.accuracy) quality.accuracyPoor++;
    if (point.speed === undefined || !Number.isFinite(point.speed) || point.speed < 0) quality.speedMissing++;
    const gap = index ? point.timestamp - run.points[index - 1].timestamp : 0;
    if (gap > RUN_CONTROL.maxGapMs) quality.intervalsOver15s++;
    quality.maxIntervalMs = Math.max(quality.maxIntervalMs, gap);
    // Respect saved manual BREAK/Resume events in both hypothetical replays.
    const manual = (run.events ?? []).filter(e => e.source === 'user' && e.timestamp <= point.timestamp && (!index || e.timestamp > run.points[index - 1].timestamp));
    if (manual.length) {
      v3 = { ...v3, events: [...(v3.events ?? []), ...manual], detector: undefined };
      legacy = { ...legacy, events: [...(legacy.events ?? []), ...manual], detector: undefined };
      replay = { ...replay, events: [...(replay.events ?? []), ...manual], detector: undefined };
    }
    const prior = legacy.detector;
    legacy = legacyDetectStop(legacy, point);
    if (legacy.detector?.stillSince !== undefined && legacy.detector.stillSince !== prior?.stillSince) quality.legacyCandidateStarts++;
    if (prior?.stillSince !== undefined && stateOf(legacy) === 'RUNNING' && legacy.detector?.stillSince !== prior.stillSince) {
      quality.legacyCandidateLosses++;
      const reason = point.accuracy === undefined || point.accuracy > RUN_CONTROL.accuracy ? 'ACCURACY_POOR'
        : prior.last && point.timestamp - prior.last.timestamp > RUN_CONTROL.maxGapMs ? 'GPS_INTERVAL_TOO_LONG'
        : prior.anchor && distanceBetween(prior.anchor, point) > RUN_CONTROL.stopRadius ? 'DISPLACEMENT_TOO_LARGE' : 'SPEED_TOO_HIGH_OR_SPIKE';
      legacyLossReasons[reason] = (legacyLossReasons[reason] ?? 0) + 1;
    }
    v3 = detectStopV3(v3, point);
    replay = detectStop(replay, point, 'replay');
  });
  return { schema: 2, buildHash, runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt,
    featuresSnapshot: run.features ?? { autoStop: false, break: false }, rawPointCount: run.points.length,
    actualEvents: run.events ?? [], recovery: run.recovery ?? null,
    liveEvidence: { retainedDecisions: run.diagnostics?.entries.length ?? 0, firstRetainedAt: run.diagnostics?.entries[0]?.timestamp ?? null, candidateTrace: run.diagnostics?.trace ?? [], traceDropped: run.diagnostics?.traceDropped ?? 0 }, overrides: run.stopOverrides ?? {}, quality,
    actualDiagnostics: run.diagnostics ?? null,
    observation: observationDiagnosticSummary(run.diagnostics?.counts ?? {}, run.points.length),
    replayNotice: '保存GPSによる仮想再判定。実際の状態/TTS/停止理由は証明しない。座標は含めない。',
    legacyV4Replay: { events: legacy.events, candidateLossReasons: legacyLossReasons },
    v3Replay: { events: v3.events, diagnostics: v3.diagnostics },
    currentReplay: { events: replay.events, diagnostics: replay.diagnostics },
  };
}

export function latestDiagnosticRun(active: ActiveRun | null, runs: RunRecord[]) { return active ?? runs[0] ?? null; }
