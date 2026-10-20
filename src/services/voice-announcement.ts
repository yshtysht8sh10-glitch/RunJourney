import SettingsStorage from '@/repositories/storage';
import { Platform } from 'react-native';

import { ActiveRun } from '@/types/run';
import { announcementClock, completedLapAnalysis, stateOf } from '@/utils/run-model';
import { analyzePace, DEFAULT_LAP_MS } from '@/utils/pace-analysis';
import { DEFAULT_VOICE_ITEMS, formatAnnouncement, VoiceItems } from '@/utils/voice-format';
import { validPaceState } from '@/domain/pace-workout';

const SETTING_KEY = '@runjourney/voice-announcement/v1';
// Keep the trigger separate from the UI so distance and other intervals can be added later.
const FIVE_MINUTES_MS = DEFAULT_LAP_MS;
const ITEMS_KEY = '@runjourney/voice-items/v1';

function nativeAnnouncer() {
  if (Platform.OS !== 'android') return null;
  // Loaded only on Android: other platforms have no native TTS service.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}

export const VoiceAnnouncement = {
  diagnostics() { return nativeAnnouncer()?.diagnostics?.() ?? null; },
  async items(): Promise<VoiceItems> {
    try {
      const stored = await SettingsStorage.getItem(ITEMS_KEY);
      return stored ? { ...DEFAULT_VOICE_ITEMS, ...JSON.parse(stored) } : DEFAULT_VOICE_ITEMS;
    } catch { return DEFAULT_VOICE_ITEMS; }
  },
  async setItems(items: VoiceItems): Promise<void> {
    await SettingsStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  },
  async test(): Promise<void> {
    const items = await this.items();
    const lap = analyzePace(15 * 60_000, 20 * 60_000, 826.73);
    nativeAnnouncer()?.test(formatAnnouncement(20 * 60_000, 3200, lap, items));
  },
  async enabled(): Promise<boolean> {
    return (await SettingsStorage.getItem(SETTING_KEY)) === 'on';
  },
  async setEnabled(enabled: boolean, activeRun: ActiveRun | null): Promise<void> {
    await SettingsStorage.setItem(SETTING_KEY, enabled ? 'on' : 'off');
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
    const clock = announcementClock(run);
    native?.updateClock(clock.activeMs, clock.paused, clock.confirmedActiveMs);
    native?.start(Date.parse(run.startedAt), FIVE_MINUTES_MS);
    native?.updateDistance(run.distanceMeters);
    void this.updateRun(run);
  },
  async updateRun(run: ActiveRun): Promise<void> {
    // Independent of #6's periodic switch, but uses its one native TTS queue.
    // Old binaries without this optional bridge keep recording normally.
    try {
      const s = run.paceWorkout;
      const allowed = validPaceState(s) && s.voice && !run.endedAt && stateOf(run) === 'RUNNING';
      const notice = validPaceState(s) ? s.notice : undefined;
      nativeAnnouncer()?.updateWorkout?.(notice?.key ?? '', notice?.message ?? '', (notice?.at ?? 0) + 20_000, allowed);
    } catch (error) { console.warn('Pace voice update failed; recording continues', error); }
    try {
      if (!(await this.enabled())) return;
      const clock = announcementClock(run);
      const active = clock.confirmedActiveMs < 0 ? clock.activeMs : clock.confirmedActiveMs;
      const native = nativeAnnouncer();
      native?.updateClock(clock.activeMs, clock.paused, clock.confirmedActiveMs);
      native?.updateDistance(run.distanceMeters);
      // A background callback can confirm stop *and* resume. Deliver all unseen
      // transitions; native persistence deduplicates monotonically by event index.
      (run.events ?? []).forEach((event, index) => {
        if (event.state === 'AUTO_STOP' && !run.features?.autoStop || event.state === 'BREAK' && !run.features?.break) return;
        native?.transition(`${run.id}:${index}:${event.timestamp}:${event.state}`, event.state === 'AUTO_STOP' ? '停止しました' : event.state === 'BREAK' ? '休憩します' : '走行を再開します');
      });
      const analysis = completedLapAnalysis(run, active);
      if (!analysis) return;
      const message = formatAnnouncement(analysis.endMs, analysis.total.distanceMeters, analysis.lap, await this.items());
      nativeAnnouncer()?.updateAnnouncement(analysis.index, message);
    } catch (error) { console.warn('Voice announcement update failed', error); }
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
