import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { RunRepository } from '@/repositories/run-repository';
import { LocationPoint } from '@/types/run';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { isStandaloneTest } from '@/utils/build';
import { AppState } from 'react-native';

export const LOCATION_TASK_NAME = 'runjourney-background-location';

type LocationTaskData = { locations: Location.LocationObject[] };

function toPoint(location: Location.LocationObject): LocationPoint {
  const { coords, timestamp } = location;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    timestamp,
    accuracy: coords.accuracy ?? undefined,
    altitude: coords.altitude ?? undefined,
    speed: coords.speed ?? undefined,
  };
}

/** Both device TaskManager and the isolated PC simulator enter this adapter. */
export async function ingestLocationBatch(locations: Location.LocationObject[], receivedAt = Date.now(), appState = AppState.currentState ?? 'unknown') {

    const updated = isStandaloneTest()
      ? await RunRepository.appendActiveObservations(locations.map(location => ({ ...toPoint(location),
        accuracy: location.coords.accuracy, speed: location.coords.speed, receivedAt })), appState,
        observed => { void VoiceAnnouncement.updateState(observed); })
      : await RunRepository.appendActivePoints(locations.map(toPoint));
    if (updated) {
      if (updated.endedAt) return;
      if (updated.finishGoal && updated.finishGoal.kind !== 'manual') {
        // Lazy load after task registration to avoid the service initialization cycle.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { RunService } = require('@/services/run-service') as typeof import('@/services/run-service');
        if (await RunService.checkGoal(updated)) return;
      }
      VoiceAnnouncement.updateDistance(updated.distanceMeters);
      await VoiceAnnouncement.updateRun(updated);
    }

}
if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask<LocationTaskData>(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) { await RunRepository.diagnosticError(); return; }
    if (data?.locations?.length) await ingestLocationBatch(data.locations);
  });
}
