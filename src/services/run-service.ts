import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { RunRepository } from '@/repositories/run-repository';
import { LOCATION_TASK_NAME } from '@/tasks/location-task';
import { ActiveRun, RunHistoryItem, RunRecord } from '@/types/run';
import { RunSettings } from '@/repositories/run-settings';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { isStandaloneTest } from '@/utils/build';
import { PaceSettingsRepository } from '@/repositories/pace-settings';
import { createPaceWorkout } from '@/domain/pace-workout';
import { FinishSettings } from '@/repositories/finish-settings';
import { achievementMessage, goalAchievement } from '@/domain/finish-goal';
import { FinishClock } from '@/services/finish-clock';
import { completionLog } from '@/services/completion-log';

const trackingOptions: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 5_000,
  distanceInterval: 5,
  deferredUpdatesDistance: 0,
  deferredUpdatesInterval: 0,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Fitness,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'RunJourneyでランニングを記録中',
    notificationBody: '画面をOFFにしても位置情報を記録します',
    notificationColor: '#E85D2A',
    killServiceOnDestroy: false,
  },
};

let stopInFlight: Promise<RunRecord | null> | null = null;
let lastFinished: RunRecord | null = null;
let manualStopAt: string | null = null;
type FinishListener = (record: RunRecord | null, error?: unknown) => void;
const finishListeners = new Set<FinishListener>();

async function assertTrackingIsAvailable(): Promise<void> {
  if (!(await TaskManager.isAvailableAsync())) {
    throw new Error('このビルドではバックグラウンド計測を利用できません。開発ビルドを使用してください。');
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('端末の位置情報をONにしてください。');
  }
  if (!(await Location.isBackgroundLocationAvailableAsync())) {
    throw new Error('この端末ではバックグラウンド位置情報を利用できません。');
  }
}

async function requestPermissions(): Promise<void> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    throw new Error('ランニング記録には位置情報の許可が必要です。');
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED) {
    throw new Error('画面OFF中も記録するには、位置情報を「常に許可」にしてください。');
  }
}

async function startLocationTask(): Promise<void> {
  // Refresh an existing Test registration after an APK update (native setOptions).
  if (isStandaloneTest() || !(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME))) {
    const active = await RunRepository.getActiveRun();
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, { ...trackingOptions,
      timeInterval: isStandaloneTest() ? 1000 : trackingOptions.timeInterval,
      distanceInterval: isStandaloneTest() || active?.features?.autoStop ? 0 : trackingOptions.distanceInterval });
  }
}

export const RunService = {
  async startRun(): Promise<ActiveRun> {
    await assertTrackingIsAvailable();
    await requestPermissions();
    const existing = await RunRepository.getActiveRun();
    if (existing) {
      if (existing.endedAt) throw new Error('終了した記録の保存を再試行してください。');
      await startLocationTask();
      if (existing.finishGoal?.kind === 'time') FinishClock.start(() => RunService.checkGoal());
      await VoiceAnnouncement.restore(existing);
      return existing;
    }

    const now = new Date().toISOString();
    const finishGoal = await FinishSettings.get();
    // Guidance must never prevent START if its preferences are unavailable.
    let paceWorkout: ActiveRun['paceWorkout'];
    try { paceWorkout = createPaceWorkout(await PaceSettingsRepository.get(), Date.parse(now)); }
    catch (error) { console.warn('Pace settings unavailable', error); }
    const active: ActiveRun = {
      id: Crypto.randomUUID(),
      startedAt: now,
      distanceMeters: 0,
      finishGoal,
      points: [],
      ...(paceWorkout ? { paceWorkout } : {}),
      features: await RunSettings.get(),
      events: [],
      ...(isStandaloneTest() ? { diagnostics: { entries: [], counts: {}, processed: 0 } } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await RunRepository.saveActiveRun(active);
    lastFinished = null;
    if (finishGoal.kind === 'time') FinishClock.start(() => RunService.checkGoal());
    try {
      await startLocationTask();
      await VoiceAnnouncement.restore(active);
      return active;
    } catch (error) {
      // START was durably committed. Preserve it if GPS/voice startup fails;
      // a restart/retry must not erase a run that may already have received fixes.
      throw error;
    }
  },

  async restoreActiveRun(): Promise<ActiveRun | null> {
    const active = await RunRepository.getActiveRun();
    if (!active) return null;
    if (active.endedAt) return active;
    if (active.finishGoal?.kind === 'time') FinishClock.start(() => RunService.checkGoal());
    await VoiceAnnouncement.restore(active);

    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();
    if (
      foreground.status === Location.PermissionStatus.GRANTED &&
      background.status === Location.PermissionStatus.GRANTED
    ) {
      try {
        await startLocationTask();
      } catch {
        // Keep and display the persisted draft even if the OS cannot restart GPS yet.
      }
    }
    return RunRepository.getActiveRun();
  },

  getActiveRun(): Promise<ActiveRun | null> {
    return RunRepository.getActiveRun();
  },

  getHistory(): Promise<RunRecord[]> {
    return RunRepository.getRuns();
  },
  async getHistoryPage(limit = 100, offset = 0): Promise<RunHistoryItem[]> {
    return (await RunRepository.getHistoryPage(limit, offset)).map(row => ({
      id: row.id, startedAt: row.started_at, endedAt: row.ended_at!, distanceMeters: row.effective_distance,
      activeRunningTime: row.effective_time, kmPerHour: row.effective_time > 0 && row.effective_distance > 0 ? row.effective_distance / row.effective_time * 3600 : null,
    }));
  },

  async breakRun() {
    const run = await RunRepository.transition('BREAK', Date.now());
    if (run) await VoiceAnnouncement.updateRun(run);
    return run;
  },
  async resumeRun() {
    const run = await RunRepository.transition('RUNNING', Date.now());
    if (run) await VoiceAnnouncement.updateRun(run);
    return run;
  },

  subscribeFinish(listener: FinishListener) { finishListeners.add(listener); return () => { finishListeners.delete(listener); }; },
  async checkGoal(run?: ActiveRun | null): Promise<RunRecord | null> {
    const active = run ?? await RunRepository.getActiveRun();
    if (!active || active.endedAt || !goalAchievement(active, Date.now())) return null;
    return RunService.stopRun(true, active.id);
  },
  stopRun(automatic = false, expectedId?: string): Promise<RunRecord | null> {
    if (stopInFlight) {
      if (!automatic) manualStopAt ??= new Date().toISOString();
      completionLog('JOIN_IN_FLIGHT', { automatic, expectedId }); return stopInFlight;
    }
    const endedAt = new Date().toISOString();
    manualStopAt = automatic ? null : endedAt;
    completionLog('FINISH_STARTED', { automatic, expectedId, requestedAt: endedAt });
    stopInFlight = (async () => {
      let frozen = await RunRepository.prepareFinish(endedAt, automatic, expectedId);
      // A newly confirmed stop can retract a provisional time-goal result.
      // A concurrent, explicit manual STOP must still be honored in that case.
      if (!frozen && manualStopAt) frozen = await RunRepository.prepareFinish(manualStopAt, false, expectedId);
      if (!frozen) return lastFinished;
      completionLog('FROZEN', { runId: frozen.id, finishGoal: frozen.finishGoal ?? { kind: 'manual' }, achievement: frozen.achievement,
        state: frozen.events?.at(-1)?.state ?? 'RUNNING', endedAt: frozen.endedAt, distanceMeters: frozen.distanceMeters });
      FinishClock.stop();
      VoiceAnnouncement.stop(frozen.id);
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
      const saved = await RunRepository.finishActiveRun(frozen.endedAt!);
      if (saved) {
        lastFinished = saved;
        completionLog('SAVE_SUCCEEDED', { runId: saved.id, endedAt: saved.endedAt, voiceEventId: saved.achievement ? `${saved.id}:finish` : null });
        // Neither listeners nor speech can turn committed history into a save failure.
        for (const listener of finishListeners) { try { listener(saved); } catch { /* UI isolated */ } }
        if (saved.achievement) {
          try { await VoiceAnnouncement.achieved(saved.id, achievementMessage(saved)); }
          catch (error) { console.warn('Achievement speech failed; history saved', error); }
        }
      }
      return saved;
    })().catch(error => {
      completionLog('FINISH_FAILED', { automatic, expectedId, error: String(error) });
      for (const listener of finishListeners) { try { listener(null, error); } catch { /* UI isolated */ } }
      throw error;
    }).finally(() => { stopInFlight = null; });
    return stopInFlight;
  },
};
