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

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask<LocationTaskData>(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) { await RunRepository.diagnosticError(); return; }
    if (!data?.locations?.length) return;
    const receivedAt = Date.now();
    const updated = isStandaloneTest()
      ? await RunRepository.appendActiveObservations(data.locations.map(location => ({ ...toPoint(location),
        accuracy: location.coords.accuracy, speed: location.coords.speed, receivedAt })), AppState.currentState ?? 'unknown')
      : await RunRepository.appendActivePoints(data.locations.map(toPoint));
    if (updated) {
      VoiceAnnouncement.updateDistance(updated.distanceMeters);
      await VoiceAnnouncement.updateRun(updated);
    }
  });
}
