import SettingsStorage from '@/repositories/storage';
import { Platform } from 'react-native';

import { ActiveRun, RunRecord } from '@/types/run';
import { finishVoice } from '@/domain/finish-voice';
import { diagnosticLog } from '@/services/diagnostic-log';
import { AdaptiveAudio } from '@/services/adaptive-audio';
import { announcementClock, completedLapAnalysis, stateOf } from '@/utils/run-model';
import { analyzePace, DEFAULT_LAP_MS } from '@/utils/pace-analysis';
import { DEFAULT_VOICE_ITEMS, formatAnnouncement, VoiceItems } from '@/utils/voice-format';
import { distanceBetween } from '@/utils/distance';
import { activeBoundaryWallTime, kilometerLaps, recoveryGuidance, stopHint, voiceSnapshot } from '@/domain/voice-guidance';
import { RunRepository } from '@/repositories/run-repository';
import { validPaceState } from '@/domain/pace-workout';

const SETTING_KEY = '@runjourney/voice-announcement/v1';
// Keep the trigger separate from the UI so distance and other intervals can be added later.
const FIVE_MINUTES_MS = DEFAULT_LAP_MS;
const ITEMS_KEY = '@runjourney/voice-items/v1';

function nativeAnnouncer() {
  if (Platform.OS !== 'android') return null;
  // Loaded only on Android: other platforms have no native TTS service.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}

export const VoiceAnnouncement = {
  async finished(run: RunRecord): Promise<void> {
    const allowed = await this.enabled() || validPaceState(run.paceWorkout) && run.paceWorkout.voice;
    if (!allowed) { diagnosticLog('RUN_FINISH_VOICE', `${run.id}:finish`, 'SUPPRESSED_VOICE_OFF', { runId: run.id }); return; }
    const summary = finishVoice(run), now = Date.now();
    await nativeAnnouncer()?.notifyBatch?.(JSON.stringify({ runId: run.id, ended: true, cancelCandidate: true, paused: true,
      notices: [{ id: `${run.id}:finish`, type: 'RUN_GOAL_FINISHED', message: summary.message, generatedAt: now, dispatchedAt: now, queuedAt: now, expiresAt: now + 30000, priority: 110, data: summary.data }] }));
  },
  async achieved(runId: string, message: string): Promise<void> {
    const now = Date.now();
    await nativeAnnouncer()?.notifyBatch?.(JSON.stringify({ runId, ended: true, cancelCandidate: true, paused: true,
      notices: [{ id: `${runId}:finish`, type: 'RUN_GOAL_FINISHED', message, queuedAt: now, expiresAt: now + 30000, priority: 110, data: { runId } }] }));
  },
  async debugLog(limit = 12): Promise<string> { return await nativeAnnouncer()?.voiceLog?.(limit) ?? '[]'; },
  diagnostics() { return nativeAnnouncer()?.diagnostics?.() ?? null; },
  async items(): Promise<VoiceItems> {
    try {
      const stored = await SettingsStorage.getItem(ITEMS_KEY);
      return stored ? { ...DEFAULT_VOICE_ITEMS, ...JSON.parse(stored) } : DEFAULT_VOICE_ITEMS;
    } catch { return DEFAULT_VOICE_ITEMS; }
  },
  async setItems(items: VoiceItems): Promise<void> {
    await SettingsStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  },
  async test(): Promise<void> {
    const items = await this.items();
    const lap = analyzePace(15 * 60_000, 20 * 60_000, 826.73);
    nativeAnnouncer()?.test(formatAnnouncement(20 * 60_000, 3200, lap, items));
  },
  async enabled(): Promise<boolean> {
    return (await SettingsStorage.getItem(SETTING_KEY)) === 'on';
  },
  async setEnabled(enabled: boolean, activeRun: ActiveRun | null): Promise<void> {
    await SettingsStorage.setItem(SETTING_KEY, enabled ? 'on' : 'off');
    if (periodicPreference) periodicPreference.value = enabled;
    if (!enabled && !activeRun?.paceWorkout?.voice) AdaptiveAudio.stop();
    if (enabled && activeRun) this.start(activeRun);
    else nativeAnnouncer()?.stop();
  },
  async restore(activeRun: ActiveRun | null): Promise<void> {
    try {
      if (activeRun && await this.enabled()) this.start(activeRun);
      else this.stop();
    } catch (error) {
      console.warn('Voice announcement could not be restored', error);
    }
  },
  start(run: ActiveRun): void {
    const native = nativeAnnouncer();
    const clock = announcementClock(run);
    native?.updateClock(clock.activeMs, clock.paused, clock.confirmedActiveMs);
    native?.start(Date.parse(run.startedAt), FIVE_MINUTES_MS);
    native?.updateDistance(run.distanceMeters);
    void this.updateRun(run);
  },
  async updateRun(run: ActiveRun): Promise<void> {
    if (nativeAnnouncer()?.notifyBatch) {
      try { await queueGuidance(run); } catch (error) { console.warn('Voice guidance failed; GPS retained', error); }
      return;
    }
    // Independent of #6's periodic switch, but uses its one native TTS queue.
    // Old binaries without this optional bridge keep recording normally.
    try {
      const s = run.paceWorkout;
      const allowed = validPaceState(s) && s.voice && !run.endedAt && stateOf(run) === 'RUNNING';
      const notice = validPaceState(s) ? s.notice : undefined;
      nativeAnnouncer()?.updateWorkout?.(notice?.key ?? '', notice?.message ?? '', (notice?.at ?? 0) + 20_000, allowed);
    } catch (error) { console.warn('Pace voice update failed; recording continues', error); }
    try {
      if (!(await this.enabled())) return;
      const clock = announcementClock(run);
      const active = clock.confirmedActiveMs < 0 ? clock.activeMs : clock.confirmedActiveMs;
      const native = nativeAnnouncer();
      native?.updateClock(clock.activeMs, clock.paused, clock.confirmedActiveMs);
      native?.updateDistance(run.distanceMeters);
      // A background callback can confirm stop *and* resume. Deliver all unseen
      // transitions; native persistence deduplicates monotonically by event index.
      (run.events ?? []).forEach((event, index) => {
        if (event.state === 'AUTO_STOP' && !run.features?.autoStop || event.state === 'BREAK' && !run.features?.break) return;
        native?.transition(`${run.id}:${index}:${event.timestamp}:${event.state}`, event.state === 'AUTO_STOP' ? '停止しました' : event.state === 'BREAK' ? '休憩します' : '走行を再開します');
      });
      const analysis = completedLapAnalysis(run, active);
      if (!analysis) return;
      const message = formatAnnouncement(analysis.endMs, analysis.total.distanceMeters, analysis.lap, await this.items());
      nativeAnnouncer()?.updateAnnouncement(analysis.index, message);
    } catch (error) { console.warn('Voice announcement update failed', error); }
  },
  async updateState(run: ActiveRun): Promise<void> {
    if (!nativeAnnouncer()?.notifyBatch) return;
    try { await queueGuidance(run, true); } catch (error) { console.warn('Early voice feedback failed; recording continues', error); }
  },
  updateDistance(distanceMeters: number): void {
    try {
      nativeAnnouncer()?.updateDistance(distanceMeters);
    } catch (error) {
      console.warn('Voice announcement distance update failed', error);
    }
  },
  stop(runId?: string): void {
    if (!runId) AdaptiveAudio.stop();
    if (runId) {
      finishedRuns.add(runId);
      while (finishedRuns.size > 32) finishedRuns.delete(finishedRuns.values().next().value!);
      if (pendingGuidance?.run.id === runId) pendingGuidance = undefined;
    }
    try {
      nativeAnnouncer()?.stop();
    } catch (error) {
      console.warn('Voice announcement stop failed', error);
    }
  },
};

let lapCache: { key: string; laps: ReturnType<typeof kilometerLaps> } | undefined;
const sentNotices = new Set<string>();
let lastBatchState = '';
let hintSession = { runId: '', active: false, lastAt: -Infinity, detectedAt: 0, lowSpeedAt: 0 };
let pendingGuidance: { run: ActiveRun; stateOnly: boolean } | undefined;
let periodicPreference: { runId: string; value: boolean } | undefined;
const finishedRuns = new Set<string>();
let guidanceInFlight: Promise<void> | undefined;
/** Coalesce callbacks while storage is busy instead of accumulating stale speech. */
function queueGuidance(run: ActiveRun, stateOnly = false): Promise<void> {
  pendingGuidance = { run, stateOnly: stateOnly && pendingGuidance?.stateOnly !== false };
  if (!guidanceInFlight) guidanceInFlight = (async () => {
    while (pendingGuidance) {
      const next = pendingGuidance; pendingGuidance = undefined;
      await updateGuidance(next.run, next.stateOnly);
    }
  })().finally(() => { guidanceInFlight = undefined; });
  return guidanceInFlight;
}
async function updateGuidance(run: ActiveRun, stateOnly: boolean) {
  if (run.endedAt || finishedRuns.has(run.id)) return;
  const native = nativeAnnouncer();
  if (periodicPreference?.runId !== run.id) periodicPreference = { runId: run.id, value: await VoiceAnnouncement.enabled() };
  const periodic = periodicPreference.value;
  // Preference I/O may queue behind a long GPS checkpoint. Evaluate freshness
  // after that wait, so a stale observation cannot create a new stop hint.
  const now = Date.now();
  const workout = validPaceState(run.paceWorkout) && run.paceWorkout.voice;
  if (!periodic && !workout) return;
  if (hintSession.runId !== run.id) hintSession = { runId: run.id, active: false, lastAt: -Infinity, detectedAt: 0, lowSpeedAt: 0 };
  const snapshot = voiceSnapshot(run, now);
  const notices: Record<string, unknown>[] = [];
  const add = (id: string, type: string, message: string, at: number, ttl: number, priority: number, data: object = {}) => {
    if (sentNotices.has(`${run.id}:${id}`)) return;
    sentNotices.add(`${run.id}:${id}`);
    if (sentNotices.size > 2048) sentNotices.delete(sentNotices.values().next().value!);
    notices.push({ id: `${run.id}:${id}`, type, message, generatedAt: now, queuedAt: now, expiresAt: at + ttl, priority, data: { ...snapshot, ...data } });
  };
  const running = stateOf(run) === 'RUNNING' && !run.endedAt;
  const observations = (await RunRepository.getRecentObservations(4000, now)).slice(-6).map(p => ({ ...p, accuracy: p.accuracy ?? undefined, speed: p.speed ?? undefined }));
  const candidate = running && !!run.features?.autoStop && stopHint(observations, now);
  if (candidate && !hintSession.active) {
    hintSession.active = true;
    hintSession.detectedAt = now;
    // Consecutive low-speed suffix is an observed proxy, not physical stop time.
    const firstLow = observations.findIndex((p, i) => observations.slice(i).every(q => q.speed !== undefined && q.speed >= 0 && q.speed <= 0.35));
    hintSession.lowSpeedAt = observations[firstLow]?.timestamp ?? now;
    const timing = { lowSpeedObservedAt: hintSession.lowSpeedAt, candidateDetectedAt: now, detectionDelayMs: now - hintSession.lowSpeedAt };
    add(`hint:${now}`, 'STOP_CANDIDATE_DETECTED', '', now, 4000, 80, { ...timing, evidence: { count: observations.length, measuredSpreadMeters: Math.max(0, ...observations.flatMap(p => observations.map(q => distanceBetween(p, q)))), observations: observations.map(p => ({ timestamp: p.timestamp, speed: p.speed, accuracy: p.accuracy })), maxSpeed: 0.35, maxSpreadMeters: 2, minDurationMs: 2000, window: 'consecutive low-speed suffix' } });
    if (now - hintSession.lastAt >= 30000) {
      hintSession.lastAt = now;
      add(`hint-voice:${now}`, 'STOP_CANDIDATE_ANNOUNCED', '停止を確認しています。', now, 4000, 80, timing);
    } else add(`hint-suppressed:${now}`, 'STOP_CANDIDATE_SUPPRESSED', '', now, 4000, 80, { reason: '30-second cooldown' });
  } else if (!candidate && hintSession.active) {
    hintSession.active = false;
    add(`hint-cancel:${now}`, 'STOP_CANDIDATE_CANCELLED', '', now, 4000, 100, { reason: running ? 'movement, GPS quality, or stale observations' : 'state changed' });
  }
  (run.events ?? []).forEach((e, index) => {
    if (e.state === 'AUTO_STOP' && !run.features?.autoStop || e.state === 'BREAK' && !run.features?.break) return;
    const type = e.state === 'AUTO_STOP' ? 'AUTO_STOP_CONFIRMED' : e.state === 'BREAK' ? 'BREAK' : e.source === 'sensor' ? 'AUTO_RESUME_CONFIRMED' : 'RESUME';
    add(`event:${index}:${e.timestamp}`, type, e.state === 'AUTO_STOP' ? '走行タイマーを一時停止しました。' : e.state === 'BREAK' ? '休憩します。' : e.source === 'sensor' ? '走行再開を検知しました。走行タイマーを再開します。' : '走行タイマーを再開します。', e.confirmedAt ?? e.timestamp, 15000, 100,
      { effectiveAt: e.timestamp, confirmedAt: e.confirmedAt ?? null, eventIndex: index,
        candidateId: run.diagnostics?.trace?.find(d => d.timestamp === (e.confirmedAt ?? e.timestamp) && ['STOP_CONFIRMED', 'RESUME_CONFIRMED'].includes(d.decision))?.pipeline?.candidateId ?? null,
        lastHintDetectedAt: hintSession.detectedAt || null, lastHintLowSpeedObservedAt: hintSession.lowSpeedAt || null,
        hintToConfirmationMs: hintSession.detectedAt && e.confirmedAt && e.confirmedAt >= hintSession.detectedAt && e.confirmedAt - hintSession.detectedAt <= 30000 ? e.confirmedAt - hintSession.detectedAt : null });
  });
  const batchState = `${run.id}:${candidate}:${running}:${snapshot.activeMs}:${snapshot.distanceMeters}`;
  const send = async () => {
    if (finishedRuns.has(run.id)) return;
    notices.forEach(n => { n.dispatchedAt = Date.now(); });
    await native?.notifyBatch?.(JSON.stringify({ notices: notices.splice(0), recovery: recoveryGuidance(run, now), cancelCandidate: !candidate, paused: !running, state: stateOf(run), latestEventIndex: (run.events?.length ?? 0) - 1, runId: run.id }));
    lastBatchState = batchState;
  };
  // State feedback must leave JS before kilometer interpolation or voice-item I/O.
  if (notices.length) await send();
  if (stateOnly) {
    if (lastBatchState !== batchState) await send();
    return;
  }
  if (workout) {
    const lapKey = `${run.id}:${Math.floor(run.distanceMeters / 1000)}:${run.events?.length ?? 0}`;
    if (lapCache?.key !== lapKey) lapCache = { key: lapKey, laps: kilometerLaps(run, now) };
    const clock = announcementClock(run);
    for (const lap of lapCache.laps) {
      if (clock.confirmedActiveMs >= 0 && lap.activeMs > clock.confirmedActiveMs) continue;
      // Convert the effective boundary back to wall time for expiry; never refresh old laps.
      if (sentNotices.has(`${run.id}:km:${lap.km}`)) continue;
      const wallAt = activeBoundaryWallTime(run, lap.activeMs, now);
      add(`km:${lap.km}`, 'KILOMETER_LAP', lap.message, wallAt, 30000, 70,
        { lapDistanceMeters: 1000, km: lap.km, startActiveMs: lap.startActiveMs, startBoundary: lap.startBoundary, endBoundary: lap.endBoundary, lapMs: lap.lapMs, lapSavingsSec: lap.lapSavings,
          cumulativeSavingsSec: lap.cumulativeSavings, distanceMeters: lap.km * 1000, activeMs: lap.activeMs,
          boundaryWallAt: wallAt, snapshotDistanceMeters: snapshot.distanceMeters, snapshotActiveMs: snapshot.activeMs });
    }
    const notice = run.paceWorkout?.notice;
    if (notice) add(notice.key, notice.goal ? 'WORKOUT_GOAL' : 'PACE_WARNING', notice.message, notice.at, 20000, notice.goal ? 60 : 20);
  }
  if (periodic) {
    const clock = announcementClock(run);
    const verifiedMs = clock.confirmedActiveMs < 0 ? clock.activeMs : clock.confirmedActiveMs;
    const due = Math.floor(verifiedMs / FIVE_MINUTES_MS);
    const analysis = due >= 1 && !sentNotices.has(`${run.id}:five:${due}`) ? completedLapAnalysis(run, verifiedMs) : null;
    if (analysis) add(`five:${analysis.index}`, 'FIVE_MINUTES', formatAnnouncement(analysis.endMs, analysis.total.distanceMeters, analysis.lap, await VoiceAnnouncement.items()),
      activeBoundaryWallTime(run, analysis.endMs, now), 20000, 40,
      { spokenWindow: 'completed 5-minute active-time lap', spokenPaceSecPerKm: analysis.lap.secondsPerKm, spokenMarathonSec: analysis.lap.projectedTimeSeconds(42195), spokenLapDurationMs: analysis.lap.durationMs, timeLapMs: analysis.endMs, timeLapDistanceMeters: analysis.lap.distanceMeters, timeLap: analysis.lap, totalAtBoundary: analysis.total });
  }
  if (notices.length || lastBatchState !== batchState) await send();
}
