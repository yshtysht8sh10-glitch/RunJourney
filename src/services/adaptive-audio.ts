import { AppState, PermissionsAndroid, Platform } from 'react-native';
import SettingsStorage from '@/repositories/storage';
const KEY = '@runjourney/noise-volume/v1';
function native() {
  if (Platform.OS !== 'android') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}
export const AdaptiveAudio = {
  async enabled() { return (await SettingsStorage.getItem(KEY)) === 'on'; },
  async setEnabled(value: boolean) {
    if (value) {
      if (Platform.OS !== 'android' || !native()?.noiseControl) return false;
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
        title: '騒音に合わせて案内音量を調整', message: '走行中に端末マイクで騒音レベルだけを測定します。音声は保存・送信しません。マイク利用表示と通知が出ます。',
        buttonPositive: '続ける', buttonNegative: 'キャンセル',
      });
      if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }
    await SettingsStorage.setItem(KEY, value ? 'on' : 'off');
    if (value) native()?.noiseControl?.('enable', '');
    if (!value) native()?.noiseControl?.('stop', '');
    return true;
  },
  async start(runId: string, workoutVoice = false) {
    try {
      if (AppState.currentState !== 'active' || !await this.enabled()) return;
      if (!workoutVoice && await SettingsStorage.getItem('@runjourney/voice-announcement/v1') !== 'on') return;
      return native()?.noiseControl?.('start', runId);
    } catch { /* Normal speech / GPS remain available. */ }
  },
  finish() { try { native()?.noiseControl?.('finish', ''); } catch { /* bounded microphone lease */ } },
  stop() { try { native()?.noiseControl?.('stop', ''); } catch { /* optional feature */ } },
  async preview() {
    if (!await this.enabled()) return 'OFF';
    return native()?.noiseControl?.('preview', 'preview') ?? 'UNSUPPORTED';
  },
  diagnostics() { try { return native()?.noiseDiagnostics?.() ?? null; } catch { return null; } },
};
