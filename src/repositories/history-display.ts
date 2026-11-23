import Storage from './storage';

export type HistoryTimeDisplay = 'timestamps' | 'elapsed';
export const HISTORY_DISPLAY_KEY = '@runjourney/running/history-time-display/v1';
type SettingsStore = Pick<typeof Storage, 'getItem' | 'setItem'>;
/** A future activity profile supplies its own store/key; never selects a RUN DB. */
export function createHistoryDisplaySettings(store: SettingsStore, key: string) {
  return {
    async get(): Promise<HistoryTimeDisplay> {
      return await store.getItem(key) === 'elapsed' ? 'elapsed' : 'timestamps';
    },
    async save(value: HistoryTimeDisplay) {
      if (value !== 'timestamps' && value !== 'elapsed') throw Error('Invalid history display');
      await store.setItem(key, value);
    },
  };
}
export const HistoryDisplaySettings = createHistoryDisplaySettings(Storage, HISTORY_DISPLAY_KEY);

/** Wall-clock duration, including pauses. Never changes the saved timestamps. */
export function historyElapsed(startedAt: string, endedAt: string) {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '経過時間不明';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60);
  return seconds >= 3600
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
