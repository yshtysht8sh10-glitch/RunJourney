import Storage from './storage';
export const CLOCK_INTERVALS = [5, 10, 15, 30] as const;
export type ClockSettings = { enabled: boolean; minutes: number };
export const DEFAULT_CLOCK: ClockSettings = { enabled: false, minutes: 10 };
let cached: ClockSettings | undefined;
export const ClockSettingsRepository = {
  async get(): Promise<ClockSettings> {
    if (cached) return { ...cached };
    const text = await Storage.getItem('@runjourney/current-time/v1');
    if (!text) { cached = { ...DEFAULT_CLOCK }; return { ...cached }; }
    const v = JSON.parse(text);
    if (typeof v.enabled !== 'boolean' || !CLOCK_INTERVALS.includes(v.minutes)) throw new Error('現在時刻の設定を確認してください');
    cached = v; return { ...v };
  },
  async save(v: ClockSettings) {
    if (typeof v.enabled !== 'boolean' || !CLOCK_INTERVALS.some(n => n === v.minutes)) throw new Error('間隔は5・10・15・30分です');
    await Storage.setItem('@runjourney/current-time/v1', JSON.stringify(v));
    cached = { ...v };
  },
};
