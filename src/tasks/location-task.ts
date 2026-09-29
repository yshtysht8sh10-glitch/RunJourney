import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { RunRepository } from '@/repositories/run-repository';
import { LocationPoint } from '@/types/run';

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
    if (error || !data?.locations?.length) return;
    await RunRepository.appendActivePoints(data.locations.map(toPoint));
  });
}
