import { requireNativeModule } from 'expo-modules-core';

type RunAnnouncer = {
  noiseControl?(action: 'start' | 'stop' | 'finish' | 'preview' | 'enable', runId: string): string;
  noiseDiagnostics?(): { status: string; running: boolean; gain: number; dbfs: number; baselineDbfs: number; inputType: number; outputType: number; updatedAt: number; summary?: string };
  appendDiagnostic?(payload: string): void;
  finishClock?(enabled: boolean): void;
  addListener?(event: 'finishClock', listener: () => void): { remove(): void };
  notifyBatch?(payload: string): Promise<void> | void;
  voiceLog?(limit: number): Promise<string>;
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
