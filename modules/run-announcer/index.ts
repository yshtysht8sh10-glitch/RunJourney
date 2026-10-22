import { requireNativeModule } from 'expo-modules-core';

type RunAnnouncer = {
  notifyBatch?(payload: string): void;
  voiceLog?(): string;
  updateWorkout?(key: string, message: string, expiresAt: number, allowed: boolean): void;
  start(startedAtMs: number, intervalMs: number): void;
  updateClock(activeMs: number, paused: boolean, confirmedActiveMs: number): void;
  transition(eventKey: string, message: string): void;
  updateDistance(distanceMeters: number): void;
  updateAnnouncement(intervalIndex: number, message: string): void;
  test(message: string): void;
  stop(): void;
  diagnostics(): { running: boolean; transitionRun: string; transitionIndex: number; ttsStatus: string; ttsStartedAt: number };
};

export default requireNativeModule<RunAnnouncer>('RunAnnouncer');
