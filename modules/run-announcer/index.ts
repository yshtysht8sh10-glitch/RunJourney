import { requireNativeModule } from 'expo-modules-core';

type RunAnnouncer = {
  start(startedAtMs: number, intervalMs: number): void;
  updateDistance(distanceMeters: number): void;
  updateAnnouncement(intervalIndex: number, message: string): void;
  test(message: string): void;
  stop(): void;
};

export default requireNativeModule<RunAnnouncer>('RunAnnouncer');
