import { Platform } from 'react-native';

let timer: ReturnType<typeof setInterval> | undefined;
let subscription: { remove(): void } | undefined;
let checking = false;
/** Android foreground-service pulse also runs when JS timers are background-throttled.
 * The persisted active clock is authoritative; a delayed pulse never shifts the end.
 */
export const FinishClock = {
  start(check: () => Promise<unknown>) {
    this.stop();
    const pulse = () => {
      if (checking) return;
      checking = true;
      void check().catch(() => undefined).finally(() => { checking = false; });
    };
    timer = setInterval(pulse, 1000);
    if (Platform.OS === 'android') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const native = require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
        subscription = native.addListener?.('finishClock', pulse);
        native.finishClock?.(true);
      } catch (error) { console.warn('Native finish clock unavailable', error); }
    }
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = undefined; subscription?.remove(); subscription = undefined;
    if (Platform.OS === 'android') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../modules/run-announcer').default.finishClock?.(false);
      } catch { /* Old binaries can still use the shared clock. */ }
    }
  },
};
