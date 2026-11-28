import type { MeasurementBinding } from './measurement-ownership';
import type { MeasurementPurpose } from '@/domain/measurement-profile';

type Port = {
  read(): Promise<MeasurementBinding | null>;
  token(owner: MeasurementBinding): Promise<string>;
  acquire(owner: MeasurementBinding, token: string): Promise<void>;
  release(owner: MeasurementBinding, token: string): Promise<void>;
};
type Entry = { purpose: MeasurementPurpose; receivedAt: number; bytes: number; submitted: number;
  owner: MeasurementBinding | null; token?: string; acquired: boolean; written: boolean;
  reported?: string;
  write(owner: MeasurementBinding): Promise<unknown>; value?: unknown; error?: unknown;
  resolve(value: unknown): void; reject(error: unknown): void };
const key = (b: MeasurementBinding) => JSON.stringify([b.purpose, b.sessionId, b.startedAt, b.generation, b.databaseKey]);

/** Process-local GPS FIFO, not a history store. Admission/release failures may be
 * retried; an executed observation callback is NEVER replayed. No raw GPS in logs.
 * Process death can lose this bounded RAM buffer; durable ownership stays fenced.
 */
export function createMeasurementInputBuffer(port: Port, options: {
  now?: () => number; retryMs?: number; maxAgeMs?: number; maxBytes?: number; maxEntries?: number;
  report?: (reason: string, count: number) => void;
} = {}) {
  const now = options.now ?? Date.now, pending: Entry[] = [];
  const report = options.report ?? ((reason, count) => console.warn('GPS input retention', { reason, count }));
  let bytes = 0, running = false, timer: ReturnType<typeof setTimeout> | null = null;
  const closed = new Set<string>();
  const stopping = new Set<MeasurementPurpose>();
  const idle: (() => void)[] = [];
  const remove = (entry: Entry) => { pending.shift(); bytes -= entry.bytes; };
  const cancel = (entry: Entry, reason: string) => { report(reason, 1); remove(entry); entry.resolve(null); };
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const e = pending[0];
        try {
          if (!e.acquired && !e.written) {
            const active = e.token ? e.owner : await port.read();
            if (!active || active.purpose !== e.purpose || !e.token && active.status !== 'ACTIVE'
              || active.startedAt > e.receivedAt || e.owner && key(e.owner) !== key(active)) {
              cancel(e, 'BINDING_CHANGED'); continue;
            }
            e.owner ??= active;
            e.token ??= await port.token(e.owner);
            await port.acquire(e.owner, e.token); e.acquired = true;
          }
          if (!e.written) {
            // Mark before invocation: even a SQL failure may have advanced RAM
            // diagnostics/observation state. That callback must not be replayed.
            e.written = true;
            try { e.value = await e.write(e.owner!); }
            catch (error) { e.error = error; report('WRITE_FAILED', 1); }
          }
          await port.release(e.owner!, e.token!);
          remove(e);
          if (e.error) e.reject(e.error); else e.resolve(e.value);
        } catch (error) {
          const expired = now() - e.submitted >= (options.maxAgeMs ?? 60000);
          if (expired && !e.token) {
            report('ADMISSION_EXPIRED', 1);
            remove(e); e.reject(error); continue;
          }
          // Once a ticket may have reached Native, keep it retryable. Forgetting
          // its receipt on timeout would strand a durable lease permanently.
          const reason = expired ? 'CONTROL_UNCONFIRMED' : e.written ? 'RELEASE_RETRY' : 'ADMISSION_RETRY';
          if (e.reported !== reason) { report(reason, pending.length); e.reported = reason; }
          timer = setTimeout(() => { timer = null; void pump(); }, options.retryMs ?? 1000);
          break;
        }
      }
    } finally {
      running = false;
      if (!pending.length) idle.splice(0).forEach(resolve => resolve());
    }
  }
  return {
    submit<T>(purpose: MeasurementPurpose, owner: MeasurementBinding | null, receivedAt: number, size: number,
      write: (fixed: MeasurementBinding) => Promise<T>): Promise<T | null> {
      if (stopping.has(purpose) || owner && closed.has(key(owner))) { report('STOP_REQUESTED', 1); return Promise.resolve(null); }
      if (!Number.isFinite(receivedAt) || !Number.isFinite(size) || size < 0
        || pending.length >= (options.maxEntries ?? 128) || bytes + size > (options.maxBytes ?? 1048576)) {
        report('CAPACITY_REJECTED', 1); return Promise.reject(Error('GPS保留容量を超えました。診断ログを確認してください'));
      }
      return new Promise<T | null>((resolve, reject) => {
        pending.push({ purpose, owner, receivedAt, bytes: size, submitted: now(), acquired: false, written: false,
          write, resolve: value => resolve(value as T | null), reject }); bytes += size;
        if (!timer) void pump();
      });
    },
    async close(owner: MeasurementBinding) {
      closed.add(key(owner));
      if (closed.size > 16) closed.delete(closed.values().next().value!);
      if (!pending.length) return;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { const index = idle.indexOf(done); if (index >= 0) idle.splice(index, 1);
          reject(Error('受信済みGPSの保存待ちです。終了を再試行してください')); }, 5000);
        const done = () => { clearTimeout(timeout); resolve(); }; idle.push(done);
      });
    },
    requestStop(purpose: MeasurementPurpose) { stopping.add(purpose); },
    reopen(owner: MeasurementBinding) { closed.delete(key(owner)); stopping.delete(owner.purpose); },
    get pendingCount() { return pending.length; },
  };
}
