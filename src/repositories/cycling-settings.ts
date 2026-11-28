import { cyclingDatabase } from './cycling-database';

export type CyclingSettings = Readonly<{ version: 1; autoStop: boolean; voice: boolean; map: boolean }>;
export const DEFAULT_CYCLING_SETTINGS: CyclingSettings = Object.freeze({ version: 1, autoStop: false, voice: true, map: false });
export const CYCLING_SETTINGS_KEY = '@runjourney/cycling/settings/v1';
export function validateCyclingSettings(value: CyclingSettings): CyclingSettings {
  if (!value || value.version !== 1 || ['autoStop', 'voice', 'map'].some(key => typeof value[key as keyof CyclingSettings] !== 'boolean')) throw Error('サイクリング設定が不正です。元の値を保持しています');
  return Object.freeze({ version: 1, autoStop: value.autoStop, voice: value.voice, map: value.map });
}
export const CyclingSettingsRepository = {
  async get() {
    const raw = await (await cyclingDatabase()).getSetting(CYCLING_SETTINGS_KEY);
    return raw === null ? { ...DEFAULT_CYCLING_SETTINGS } : validateCyclingSettings(JSON.parse(raw));
  },
  async save(value: CyclingSettings) {
    await (await cyclingDatabase()).setSetting(CYCLING_SETTINGS_KEY, JSON.stringify(validateCyclingSettings(value)));
  },
};
