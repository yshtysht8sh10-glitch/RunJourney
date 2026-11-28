import { measurementProfile, type MeasurementPurpose } from '@/domain/measurement-profile';

export type MeasurementBinding = Readonly<{
  sessionId: string; purpose: MeasurementPurpose; databaseKey: string; profileVersion: 1;
  startedAt: number; generation: number; status: 'STARTING' | 'ACTIVE' | 'STOPPING' | 'FINISH_FAILED';
}>;
export type OwnershipState = { version: 1; generation: number; binding: MeasurementBinding | null; leases: Record<string, number> };
export type OwnershipPort = (action: string, payload: string) => Promise<string>;

function binding(value: MeasurementBinding): MeasurementBinding {
  const profile = measurementProfile(value.purpose);
  if (value.databaseKey !== (profile.databaseName ?? 'none') || value.profileVersion !== 1
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId)
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || !Number.isFinite(value.startedAt) || value.startedAt < 0
    || !['STARTING', 'ACTIVE', 'STOPPING', 'FINISH_FAILED'].includes(value.status)) throw Error('計測所有権が不正です。新規開始を停止しました');
  return Object.freeze({ ...value });
}
function state(text: string): OwnershipState {
  if (text.length > 32768) throw Error('計測所有権が大きすぎます');
  const raw = JSON.parse(text) as OwnershipState;
  if (raw.version !== 1 || !Number.isSafeInteger(raw.generation) || raw.generation < 0
    || !raw.leases || Array.isArray(raw.leases) || typeof raw.leases !== 'object'
    || Object.keys(raw.leases).length > 128) throw Error('未対応の計測所有権です');
  const active = raw.binding === null ? null : binding(raw.binding);
  if (active && active.generation !== raw.generation
    || !active && Object.keys(raw.leases).length
    || Object.values(raw.leases).some(generation => generation !== raw.generation)) throw Error('計測所有権と書込み状態が一致しません');
  return { ...raw, binding: active };
}

/** Injectable port for focused tests. Runtime uses Native atomic file + cross-process lock.
 * No JS-only mutex fallback: an old APK must fail closed instead of enabling a second sport.
 */
export function createMeasurementOwnership(port: OwnershipPort) {
  const command = async (action: string, value: unknown = {}) => port(action, JSON.stringify(value));
  return {
    read: async () => state(await command('read')),
    async claim(purpose: MeasurementPurpose, sessionId: string, startedAt: number) {
      const profile = measurementProfile(purpose);
      const result = state(await command('claim', { purpose, sessionId, startedAt,
        databaseKey: profile.databaseName ?? 'none', profileVersion: profile.version }));
      if (!result.binding || result.binding.purpose !== purpose || result.binding.sessionId !== sessionId) throw Error('計測開始の保存ACKが一致しません');
      return result.binding;
    },
    async activate(owner: MeasurementBinding) { return state(await command('activate', binding(owner))); },
    async stop(owner: MeasurementBinding) { return state(await command('stop', binding(owner))); },
    async failed(owner: MeasurementBinding) { return state(await command('failed', binding(owner))); },
    /** Invoke only after OS tracking stop AND the bound sink's final durable ACK. */
    async finish(owner: MeasurementBinding) { return state(await command('finish', binding(owner))); },
    async withWriteLease<T>(owner: MeasurementBinding, write: (fixed: MeasurementBinding) => Promise<T>): Promise<T> {
      const lease = JSON.parse(await command('lease', binding(owner))) as { token: string; binding: MeasurementBinding };
      const fixed = binding(lease.binding);
      if (!lease.token || typeof lease.token !== 'string' || fixed.sessionId !== owner.sessionId
        || fixed.generation !== owner.generation || fixed.purpose !== owner.purpose) throw Error('書込みリースが一致しません');
      try { return await write(fixed); }
      finally { state(await command('release', { ...fixed, token: lease.token })); }
    },
  };
}

export const MeasurementOwnership = createMeasurementOwnership(async (action, payload) => {
  // Lazy: existing Running imports remain usable on old builds until explicitly connected.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
  if (!native.measurementOwnership) throw Error('このTest APKは競技別の計測所有権に未対応です');
  return native.measurementOwnership(action, payload);
});
