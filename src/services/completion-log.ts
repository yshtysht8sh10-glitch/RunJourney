import { Platform } from 'react-native';
/** Bounded native journal, shared with the locally exported voice lifecycle.
 * No coordinates, network requests, or dependency on diagnostics success.
 */
export function completionLog(status: string, data: object = {}) {
  try {
    if (Platform.OS !== 'android') return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
    native.appendDiagnostic?.(JSON.stringify({ type: 'RUN_COMPLETION', status, data, loggedAt: Date.now() }));
  } catch { /* Recording and saving always take priority. */ }
}
