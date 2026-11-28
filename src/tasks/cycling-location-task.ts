import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { CyclingRepository } from '@/repositories/cycling-repository';
import { MeasurementSessions } from '@/services/measurement-sessions';
import { CyclingVoice } from '@/services/cycling-voice';

export const CYCLING_LOCATION_TASK_NAME = 'runjourney-cycling-location';
export async function ingestCyclingLocationBatch(locations: Location.LocationObject[], receivedAt = Date.now(), appState = AppState.currentState ?? 'unknown') {
  const updated = await MeasurementSessions.withInput('cycling', async owner => {
    const active = await CyclingRepository.getActive();
    if (!active || active.id !== owner.sessionId || Date.parse(active.startedAt) !== owner.startedAt) throw Error('サイクリングの保存先所有権が一致しません');
    return CyclingRepository.ingest(locations.map(({ coords, timestamp }) => ({ timestamp, receivedAt,
      latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, speed: coords.speed,
      altitude: coords.altitude ?? undefined })), appState);
  });
  if (updated && !updated.endedAt) void CyclingVoice.update(updated, receivedAt).catch(error => console.warn('Cycling voice unavailable; GPS retained', error));
  return updated;
}
if (!TaskManager.isTaskDefined(CYCLING_LOCATION_TASK_NAME)) TaskManager.defineTask<{ locations: Location.LocationObject[] }>(CYCLING_LOCATION_TASK_NAME, async ({ data, error }) => {
  // OS errors do not touch Running diagnostics or dispose the retryable Cycling draft.
  if (error) { console.warn('Cycling GPS task error; draft retained'); return; }
  if (data?.locations?.length) await ingestCyclingLocationBatch(data.locations);
});
