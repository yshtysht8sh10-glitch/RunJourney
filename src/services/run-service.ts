import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Application from 'expo-application';

import { RunRepository } from '@/repositories/run-repository';
import { LOCATION_TASK_NAME } from '@/tasks/location-task';
import { ActiveRun, RunRecord } from '@/types/run';
import { RunSettings } from '@/repositories/run-settings';
import { VoiceAnnouncement } from '@/services/voice-announcement';

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
  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME))) {
    const active = await RunRepository.getActiveRun();
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, { ...trackingOptions, distanceInterval: active?.features?.autoStop ? 0 : trackingOptions.distanceInterval });
  }
}

export const RunService = {
  async startRun(): Promise<ActiveRun> {
    await assertTrackingIsAvailable();
    await requestPermissions();
    const existing = await RunRepository.getActiveRun();
    if (existing) {
      await startLocationTask();
      await VoiceAnnouncement.restore(existing);
      return existing;
    }

    const now = new Date().toISOString();
    const active: ActiveRun = {
      id: Crypto.randomUUID(),
      startedAt: now,
      distanceMeters: 0,
      points: [],
      features: await RunSettings.get(),
      events: [],
      ...(Application.applicationId === 'app.runjourney.mobile.test' ? { diagnostics: { entries: [], counts: {}, processed: 0 } } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await RunRepository.saveActiveRun(active);
    try {
      await startLocationTask();
      await VoiceAnnouncement.restore(active);
      return active;
    } catch (error) {
      await RunRepository.clearActiveRun();
      throw error;
    }
  },

  async restoreActiveRun(): Promise<ActiveRun | null> {
    const active = await RunRepository.getActiveRun();
    if (!active) return null;
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

  async stopRun(): Promise<RunRecord | null> {
    VoiceAnnouncement.stop();
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    return RunRepository.finishActiveRun(new Date().toISOString());
  },
};
