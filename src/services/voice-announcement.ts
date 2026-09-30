import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { ActiveRun } from '@/types/run';

const SETTING_KEY = '@runjourney/voice-announcement/v1';
// Keep the trigger separate from the UI so distance and other intervals can be added later.
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function nativeAnnouncer() {
  if (Platform.OS !== 'android') return null;
  // Loaded only on Android: other platforms have no native TTS service.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}

export const VoiceAnnouncement = {
  async enabled(): Promise<boolean> {
    return (await AsyncStorage.getItem(SETTING_KEY)) === 'on';
  },
  async setEnabled(enabled: boolean, activeRun: ActiveRun | null): Promise<void> {
    await AsyncStorage.setItem(SETTING_KEY, enabled ? 'on' : 'off');
    if (enabled && activeRun) this.start(activeRun);
    else nativeAnnouncer()?.stop();
  },
  async restore(activeRun: ActiveRun | null): Promise<void> {
    try {
      if (activeRun && await this.enabled()) this.start(activeRun);
      else this.stop();
    } catch (error) {
      console.warn('Voice announcement could not be restored', error);
    }
  },
  start(run: ActiveRun): void {
    const native = nativeAnnouncer();
    native?.start(Date.parse(run.startedAt), FIVE_MINUTES_MS);
    native?.updateDistance(run.distanceMeters);
  },
  updateDistance(distanceMeters: number): void {
    try {
      nativeAnnouncer()?.updateDistance(distanceMeters);
    } catch (error) {
      console.warn('Voice announcement distance update failed', error);
    }
  },
  stop(): void {
    try {
      nativeAnnouncer()?.stop();
    } catch (error) {
      console.warn('Voice announcement stop failed', error);
    }
  },
};
