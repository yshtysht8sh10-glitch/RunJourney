import Storage from './storage';
import { DEFAULT_PACE_SETTINGS, PaceSettings, validPaceSettings } from '../domain/pace-workout';
export const PACE_SETTINGS_KEY = '@runjourney/pace-workout/v1';
export const PaceSettingsRepository = {
  async get(): Promise<PaceSettings> {
    try {
      const text = await Storage.getItem(PACE_SETTINGS_KEY);
      const value: unknown = text ? JSON.parse(text) : null;
      return validPaceSettings(value) ? value : { ...DEFAULT_PACE_SETTINGS };
    } catch { return { ...DEFAULT_PACE_SETTINGS }; }
  },
  async save(value: PaceSettings) {
    if (!validPaceSettings(value)) throw new Error('距離0.1〜200km、ペース2〜30分/km、許容幅0〜120秒、通知60〜600秒、目標時間48時間以内で設定してください');
    await Storage.setItem(PACE_SETTINGS_KEY, JSON.stringify(value));
  },
};
