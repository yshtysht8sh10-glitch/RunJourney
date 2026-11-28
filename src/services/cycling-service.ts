import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Crypto from 'expo-crypto';
import { CYCLING_PROFILE } from '@/domain/measurement-profile';
import { CyclingRepository } from '@/repositories/cycling-repository';
import { CyclingSettingsRepository } from '@/repositories/cycling-settings';
import { TopSettingsRepository } from '@/repositories/top-settings';
import { CYCLING_LOCATION_TASK_NAME } from '@/tasks/cycling-location-task';
import { MeasurementSessions, measurementOwnershipAvailable } from './measurement-sessions';
import { CyclingVoice } from './cycling-voice';
import type { CyclingDraft } from '@/repositories/cycling-recorder';
import type { RunRecord } from '@/types/run';

let starting: Promise<CyclingDraft> | null = null;
let stopping: Promise<RunRecord | null> | null = null;
let lastSaved: RunRecord | null = null;
const options: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High, timeInterval: CYCLING_PROFILE.requestIntervalMs, distanceInterval: 0,
  deferredUpdatesDistance: 0, deferredUpdatesInterval: 0, pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Fitness, showsBackgroundLocationIndicator: true,
  foregroundService: { notificationTitle: 'RunJourneyでサイクリングを記録中', notificationBody: '画面をOFFにしても位置情報を記録します',
    notificationColor: '#E85D2A', killServiceOnDestroy: false },
};
async function startGps() { await Location.startLocationUpdatesAsync(CYCLING_LOCATION_TASK_NAME, options); }
export const CyclingService = {
  start(): Promise<CyclingDraft> {
    if (starting) return starting;
    starting = (async () => {
      if (!measurementOwnershipAvailable()) throw Error('このAPKはサイクリング計測に未対応です');
      const top = await TopSettingsRepository.get();
      if (!top.assistantEnabled) throw Error('運動アシスタントをONにしてください');
      if (!(await TaskManager.isAvailableAsync()) || !(await Location.isBackgroundLocationAvailableAsync())) throw Error('バックグラウンドGPSを使用できません');
      if (!(await Location.hasServicesEnabledAsync())) throw Error('端末の位置情報をONにしてください');
      if ((await Location.requestForegroundPermissionsAsync()).status !== Location.PermissionStatus.GRANTED
        || (await Location.requestBackgroundPermissionsAsync()).status !== Location.PermissionStatus.GRANTED) throw Error('画面OFF中の記録には位置情報を「常に許可」にしてください');
      const owner = await MeasurementSessions.forStart('cycling');
      let active = await CyclingRepository.getActive();
      if (active?.endedAt) throw Error('終了したサイクリングの保存を再試行してください');
      if (!active) {
        if (owner && owner.status !== 'STARTING') throw Error('所有権と記録が一致しません。新規開始せず確認してください');
        const id = owner?.sessionId ?? Crypto.randomUUID(), at = owner?.startedAt ?? Date.now();
        const fixed = await MeasurementSessions.ensure('cycling', id, at);
        active = await CyclingRepository.create(id, new Date(at).toISOString(), await CyclingSettingsRepository.get());
        await MeasurementSessions.activate(fixed);
      } else await MeasurementSessions.activate(await MeasurementSessions.ensure('cycling', active.id, Date.parse(active.startedAt)));
      await startGps(); lastSaved = null;
      void CyclingVoice.update(active).catch(error => console.warn('Cycling voice unavailable; GPS retained', error));
      return active;
    })().finally(() => { starting = null; }); return starting;
  },
  getActive: () => CyclingRepository.getActive(),
  async restore() {
    if (!measurementOwnershipAvailable()) throw Error('サイクリングに対応するTest APKが必要です');
    const active = await CyclingRepository.getActive(); if (!active || active.endedAt) return active;
    await MeasurementSessions.activate(await MeasurementSessions.ensure('cycling', active.id, Date.parse(active.startedAt)));
    const foreground = await Location.getForegroundPermissionsAsync(), background = await Location.getBackgroundPermissionsAsync();
    if (foreground.status !== Location.PermissionStatus.GRANTED || background.status !== Location.PermissionStatus.GRANTED) throw Error('未終了記録を保持しています。GPS権限を確認してください');
    await startGps(); void CyclingVoice.update(active).catch(() => undefined); return active;
  },
  async pause(paused: boolean) {
    const active = await MeasurementSessions.withInput('cycling', () => CyclingRepository.pause(paused, Date.now()));
    if (active) void CyclingVoice.update(active).catch(() => undefined); return active;
  },
  stop(): Promise<RunRecord | null> {
    if (stopping) return stopping;
    const endedAt = new Date().toISOString();
    MeasurementSessions.requestInputStop('cycling');
    stopping = (async () => {
      const owner = await MeasurementSessions.reconcile();
      if (!owner) return lastSaved;
      if (owner.purpose !== 'cycling') throw Error('別用途の計測を終了することはできません');
      await MeasurementSessions.freeze(owner);
      const frozen = await CyclingRepository.prepareFinish(endedAt);
      if (!frozen) {
        if (lastSaved?.id !== owner.sessionId) throw Error('未終了記録を確認できません。所有権を保持しています');
      }
      if (await Location.hasStartedLocationUpdatesAsync(CYCLING_LOCATION_TASK_NAME)) await Location.stopLocationUpdatesAsync(CYCLING_LOCATION_TASK_NAME);
      if (frozen) {
        lastSaved = await CyclingRepository.finish();
        // Audio failure cannot roll back committed history or block normal GPS shutdown.
        await CyclingVoice.stop(frozen).catch(error => console.warn('Cycling voice stop failed; history saved', error));
      }
      await MeasurementSessions.finish(owner); return lastSaved;
    })().finally(() => { stopping = null; }); return stopping;
  },
};
