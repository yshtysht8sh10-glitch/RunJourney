export type LocationPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
};

export type RunRecord = {
  id: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  points: LocationPoint[];
  createdAt: string;
  updatedAt: string;
  features?: { autoStop: boolean; break: boolean };
  events?: RunEvent[];
  detector?: { version?: 2; anchor?: LocationPoint; last?: LocationPoint; stillSince?: number; movement?: { startedAt: number; origin: LocationPoint; fixes: number } };
};

export type RunState = 'RUNNING' | 'AUTO_STOP' | 'BREAK';
export type RunEvent = { timestamp: number; state: RunState; source: 'sensor' | 'user'; confirmedAt?: number; reason?: string };

export type ActiveRun = Omit<RunRecord, 'endedAt'> & { endedAt?: string };
