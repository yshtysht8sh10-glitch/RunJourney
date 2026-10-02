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
  detector?: { anchor?: LocationPoint; last?: LocationPoint; stillSince?: number };
};

export type RunState = 'RUNNING' | 'AUTO_STOP' | 'BREAK';
export type RunEvent = { timestamp: number; state: RunState; source: 'sensor' | 'user'; reason?: string };

export type ActiveRun = Omit<RunRecord, 'endedAt'> & { endedAt?: string };
