/** Storage destinations are capabilities, never values supplied by a route. */
export type ActivityKind = 'running' | 'cycling';
export type MeasurementPurpose = ActivityKind | 'generic';
export type DistancePolicy = Readonly<{ maxSpeedMetersPerSecond: number; maxGapMs?: number }>;
export type MeasurementProfile = Readonly<{
  purpose: MeasurementPurpose;
  version: 1;
  databaseName: 'runjourney.sqlite' | 'runjourney-cycling.sqlite' | null;
  distance: DistancePolicy;
  requestIntervalMs: number;
  persistenceIntervalMs: number;
  features: Readonly<{ history: boolean; pace: boolean; autoStop: boolean; sportVoice: boolean; cloudSync: boolean }>;
}>;

const profile = (value: MeasurementProfile): MeasurementProfile => Object.freeze({ ...value,
  distance: Object.freeze({ ...value.distance }), features: Object.freeze({ ...value.features }) });

export const RUNNING_PROFILE = profile({ purpose: 'running', version: 1, databaseName: 'runjourney.sqlite',
  // No new gap filter: preserve the existing Running distance model exactly.
  distance: { maxSpeedMetersPerSecond: 12.5 }, requestIntervalMs: 5000, persistenceIntervalMs: 5000,
  features: { history: true, pace: true, autoStop: true, sportVoice: true, cloudSync: true } });
export const CYCLING_PROFILE = profile({ purpose: 'cycling', version: 1, databaseName: 'runjourney-cycling.sqlite',
  // Engineering limits from Phase 0, not a claim of real-world accuracy.
  distance: { maxSpeedMetersPerSecond: 30, maxGapMs: 15000 }, requestIntervalMs: 1000, persistenceIntervalMs: 5000,
  features: { history: true, pace: false, autoStop: true, sportVoice: true, cloudSync: false } });
export const GENERIC_PROFILE = profile({ purpose: 'generic', version: 1, databaseName: null,
  distance: { maxSpeedMetersPerSecond: 30, maxGapMs: 15000 }, requestIntervalMs: 1000, persistenceIntervalMs: 5000,
  features: { history: false, pace: false, autoStop: false, sportVoice: false, cloudSync: false } });

export function measurementProfile(purpose: MeasurementPurpose): MeasurementProfile {
  switch (purpose) {
    case 'running': return RUNNING_PROFILE;
    case 'cycling': return CYCLING_PROFILE;
    case 'generic': return GENERIC_PROFILE;
    default: throw new Error('未対応の計測用途です');
  }
}

export function activityDatabaseName(kind: ActivityKind) {
  const selected = measurementProfile(kind);
  if (!selected.features.history || !selected.databaseName) throw new Error('この用途は運動履歴を保存できません');
  return selected.databaseName;
}
