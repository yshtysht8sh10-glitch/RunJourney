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
};

export type ActiveRun = Omit<RunRecord, 'endedAt'> & { endedAt?: string };
