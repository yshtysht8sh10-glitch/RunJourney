import { Platform, PermissionsAndroid } from 'react-native';
import * as Application from 'expo-application';
import { DetectorJournal } from '@/services/detector-journal';

type ClockLocation = { timestamp: number; diagnosticElapsedNanos?: string; diagnosticSerializedNanos?: string };
function native() {
  if (Platform.OS !== 'android' || Application.applicationId !== 'app.runjourney.mobile.test') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}
/** Optional diagnostic observer. Never returns data to the RUN model or speech. */
export const SensorDiagnostics = {
  available: () => Platform.OS === 'android' && Application.applicationId === 'app.runjourney.mobile.test',
  control(action: string, value = '') { try { return native()?.sensorControl?.(action, value) ?? false; } catch { return false; } },
  begin(runId: string) { this.runId = runId; this.control('gpsStatus', DetectorJournal.status); this.control('begin', runId); },
  async requestAlerts() {
    if (!this.available()) return false;
    try {
      if (Number(Platform.Version) >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Test診断の警告通知', message: '画面OFF中も診断の停止を確認するための通知です。既存の音声案内には追加しません。', buttonPositive: '続ける', buttonNegative: 'キャンセル',
      });
      this.lastAlertsCheck = 0;
      return native()?.sensorNotificationsAllowed?.() === true;
    } catch { return false; }
  },
  lastAlertsCheck: 0,
  alertsAllowed: false,
  status() {
    try {
      const bridge = native(); if (!bridge) return null;
      if (!bridge.sensorStats || !bridge.markerStats) throw Error('DIAGNOSTIC_API_UNAVAILABLE');
      if (Date.now() - this.lastAlertsCheck >= 5000) { this.lastAlertsCheck = Date.now(); this.alertsAllowed = bridge.sensorNotificationsAllowed?.() === true; }
      return { sensor: { ...JSON.parse(bridge.sensorStats?.() ?? '{}'), notificationsAllowed: this.alertsAllowed }, marker: JSON.parse(bridge.markerStats?.() ?? '{}') };
    } catch { return { sensor: { state: 'FAILED', warning: '診断状態を取得できません。採取成立を確認できません。' }, marker: { accepting: false } }; }
  },
  end(runId: string) { this.control('endRun', runId); },
  gps(locations: ClockLocation[], receivedAt: number) {
    try {
      const bridge = native(); if (!bridge) return;
      if (this.lastGpsStatus !== DetectorJournal.status) {
        this.lastGpsStatus = DetectorJournal.status; bridge.sensorControl?.('gpsStatus', DetectorJournal.status);
      }
      if (this.runId && !['ARMED', 'RECORDING'].includes(DetectorJournal.status)) {
        bridge.sensorControl?.(DetectorJournal.status === 'SEALED_PENDING_VERIFICATION' ? 'gpsEnded' : 'gpsFailed', this.runId); return;
      }
      locations.forEach((p, ordinal) => bridge.sensorGps?.(JSON.stringify({
        runId: this.runId, gpsCaptureId: DetectorJournal.captureId ?? null, ordinal, epochMs: p.timestamp, jsReceivedWallMs: receivedAt,
        fixElapsedNs: p.diagnosticElapsedNanos ?? null, serializedElapsedNs: p.diagnosticSerializedNanos ?? null,
      })));
    } catch { /* An optional diagnostic must never reject normal GPS. */ }
  },
  runId: '',
  lastGpsStatus: '',
};
