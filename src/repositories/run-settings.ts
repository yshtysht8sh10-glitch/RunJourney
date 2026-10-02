import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = '@runjourney/run-features/v1';
export type RunFeatures = { autoStop: boolean; break: boolean };
export const DEFAULT_RUN_FEATURES: RunFeatures = { autoStop: false, break: false };
export const RunSettings = {
  async get(): Promise<RunFeatures> {
    const stored = await AsyncStorage.getItem(KEY);
    if (!stored) return { ...DEFAULT_RUN_FEATURES };
    try { const value = JSON.parse(stored); return { autoStop: value.autoStop === true, break: value.break === true }; }
    catch { return { ...DEFAULT_RUN_FEATURES }; }
  },
  async save(value: RunFeatures) { await AsyncStorage.setItem(KEY, JSON.stringify(value)); },
};
