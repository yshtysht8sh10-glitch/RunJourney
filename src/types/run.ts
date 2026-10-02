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
  detector?: { version?: 2 | 3; anchor?: LocationPoint; last?: LocationPoint; stillSince?: number; movement?: { startedAt: number; origin: LocationPoint; fixes: number } };
  stopOverrides?: Record<string, { included: boolean; updatedAt: string }>;
  diagnostics?: { entries: StopDiagnostic[]; counts: Record<string, number>; processed: number };
};

export type RunState = 'RUNNING' | 'AUTO_STOP' | 'BREAK';
export type RunEvent = { timestamp: number; state: RunState; source: 'sensor' | 'user'; confirmedAt?: number; reason?: string };

export type ActiveRun = Omit<RunRecord, 'endedAt'> & { endedAt?: string };

export const StopReason = {
  SPEED_TOO_HIGH: 'SPEED_TOO_HIGH', DISPLACEMENT_TOO_LARGE: 'DISPLACEMENT_TOO_LARGE',
  ACCURACY_POOR: 'ACCURACY_POOR', GPS_INTERVAL_TOO_LONG: 'GPS_INTERVAL_TOO_LONG',
  CANDIDATE_TIMEOUT: 'CANDIDATE_TIMEOUT', STATE_CHANGED: 'STATE_CHANGED',
  SETTING_DISABLED: 'SETTING_DISABLED', INVALID_FIX: 'INVALID_FIX',
  STALE_FIX: 'STALE_FIX', SPEED_SPIKE: 'SPEED_SPIKE', OBSERVATION_REQUIRED: 'OBSERVATION_REQUIRED',
  SPEED_TOO_LOW: 'SPEED_TOO_LOW', MOVEMENT_TOO_SMALL: 'MOVEMENT_TOO_SMALL',
} as const;
export type StopReasonCode = typeof StopReason[keyof typeof StopReason];
export type StopDiagnostic = {
  timestamp: number; receivedAt?: number; state: RunState; accuracy?: number;
  speed?: number; effectiveSpeed?: number; displacement?: number; originDisplacement?: number;
  intervalMs?: number; candidateStartedAt?: number; candidateAgeMs?: number;
  decision: 'START' | 'CONTINUE' | 'RESET' | 'HOLD' | 'SKIP' | 'STOP_CONFIRMED' | 'RESUME_CONFIRMED';
  reason?: StopReasonCode;
};
