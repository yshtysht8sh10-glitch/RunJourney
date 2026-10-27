import { Platform } from 'react-native';
export function diagnosticLog(type: string, id: string, status: string, data: object) {
  try {
    if (Platform.OS !== 'android') return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
    native.appendDiagnostic?.(JSON.stringify({ type, id, status, data, loggedAt: Date.now() }));
  } catch { /* Telemetry never participates in recording/save success. */ }
}
