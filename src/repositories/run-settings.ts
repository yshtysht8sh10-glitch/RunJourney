import SettingsStorage from '@/repositories/storage';
const KEY = '@runjourney/run-features/v1';
export type RunFeatures = { autoStop: boolean; break: boolean };
export const DEFAULT_RUN_FEATURES: RunFeatures = { autoStop: false, break: false };
export const RunSettings = {
  async get(): Promise<RunFeatures> {
    const stored = await SettingsStorage.getItem(KEY);
    if (!stored) return { ...DEFAULT_RUN_FEATURES };
    try { const value = JSON.parse(stored); return { autoStop: value.autoStop === true, break: value.break === true }; }
    catch { return { ...DEFAULT_RUN_FEATURES }; }
  },
  async save(value: RunFeatures) { await SettingsStorage.setItem(KEY, JSON.stringify(value)); },
};
