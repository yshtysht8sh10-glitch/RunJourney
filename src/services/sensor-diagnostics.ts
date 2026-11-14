import { Platform } from 'react-native';
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
  control(action: string, value = '') { try { return native()?.sensorControl?.(action, value) ?? false; } catch { return false; } },
  begin(runId: string) { this.control('begin', runId); },
  end(runId: string) { this.control('endRun', runId); },
  gps(locations: ClockLocation[], receivedAt: number) {
    try {
      const bridge = native(); if (!bridge) return;
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
};
