import type { MeasurementPurpose } from '@/domain/measurement-profile';
import { createMeasurementOwnership, MeasurementOwnership, type MeasurementBinding } from './measurement-ownership';

type DraftHeader = { id: string; startedAt: string; endedAt: string | null };
export type DraftInspection = { running: DraftHeader | null; cycling: DraftHeader | null; unownedTracking: boolean; trackingPurposes?: MeasurementPurpose[] };
type Client = ReturnType<typeof createMeasurementOwnership>;
export type CompletionRecovery = {
  completed(owner: MeasurementBinding): Promise<boolean>;
  stopTracking(purpose: MeasurementPurpose): Promise<void>;
};

/** No mutable selected-sport global. A bound ID/destination survives route changes.
 * Inspection is read-only and never clears competing drafts or unowned GPS registrations.
 */
export function createMeasurementSessions(client: Client, inspect: () => Promise<DraftInspection>, recovery?: CompletionRecovery) {
  const reconcile = async (): Promise<MeasurementBinding | null> => {
    const current = await client.read();
    const drafts = await inspect();
    if (drafts.running && drafts.cycling) throw Error('両競技に未終了記録があります。新規開始せず確認してください');
    const kind = drafts.running ? 'running' : drafts.cycling ? 'cycling' : null;
    const draft = drafts.running ?? drafts.cycling;
    if (current.binding) {
      if (drafts.trackingPurposes?.some(purpose => purpose !== current.binding!.purpose)) throw Error('GPS登録と計測用途が一致しません。新規開始せず確認してください');
      if (draft && (current.binding.purpose !== kind || current.binding.sessionId !== draft.id)) throw Error('計測所有権と未終了記録が一致しません');
      if (!draft && recovery && ['STOPPING', 'FINISH_FAILED'].includes(current.binding.status)) {
        if (Object.keys(current.leases).length) throw Error('終了書込みの成否が未確定です。記録と所有権を保持しています');
        if (!(await recovery.completed(current.binding))) throw Error('保存済みの終了記録を照合できません。削除・初期化せず確認してください');
        await recovery.stopTracking(current.binding.purpose);
        await client.stop(current.binding); await client.finish(current.binding);
        return null;
      }
      return current.binding;
    }
    if (!draft || !kind) {
      if (drafts.unownedTracking) throw Error('所有者を確認できないGPS計測があります。新規開始を停止しています');
      return null;
    }
    if (drafts.trackingPurposes?.some(purpose => purpose !== kind)) throw Error('未終了記録とGPS登録が一致しません');
    const startedAt = Date.parse(draft.startedAt);
    if (!Number.isFinite(startedAt)) throw Error('未終了記録の開始日時を確認できません');
    const adopted = await client.claim(kind, draft.id, startedAt, true);
    const result = draft.endedAt ? await client.stop(adopted) : await client.activate(adopted);
    return result.binding;
  };
  return {
    reconcile,
    async forStart(purpose: MeasurementPurpose) {
      const active = await reconcile();
      if (active && (active.purpose !== purpose || active.status !== 'STARTING' && active.status !== 'ACTIVE')) throw Error('別の計測又は保存処理が続いています。計測へ戻ってください');
      return active;
    },
    async ensure(purpose: MeasurementPurpose, id: string, startedAt: number) {
      const active = await reconcile();
      if (active) {
        if (active.purpose !== purpose || active.sessionId !== id || active.startedAt !== startedAt) throw Error('別用途・別IDへの計測切替はできません');
        return active;
      }
      return client.claim(purpose, id, startedAt);
    },
    async activate(owner: MeasurementBinding) {
      const active = (await client.read()).binding;
      if (!active || active.sessionId !== owner.sessionId || active.generation !== owner.generation) throw Error('計測所有権が変更されています');
      if (active.status === 'ACTIVE') return active;
      const result = await client.activate(owner); return result.binding!;
    },
    async withInput<T>(purpose: MeasurementPurpose, write: (owner: MeasurementBinding) => Promise<T>) {
      // The hot path needs only the atomic owner, not two SQLite opens per fix.
      // Read-only draft reconciliation is needed once when adopting an old RUN.
      const active = (await client.read()).binding ?? await reconcile();
      if (!active || active.purpose !== purpose || active.status !== 'ACTIVE') return null;
      return client.withWriteLease(active, write);
    },
    async freeze(owner: MeasurementBinding) {
      await client.stop(owner);
      // A timeout reports uncertainty and leaves STOPPING fenced; it never releases ownership.
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await client.read();
        if (state.binding?.sessionId !== owner.sessionId || state.binding.generation !== owner.generation) throw Error('終了対象の所有権が一致しません');
        if (!Object.keys(state.leases).length) return state.binding;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error('GPS書込みの完了を確認できません。所有権を保持して終了を再試行してください');
    },
    finish: (owner: MeasurementBinding) => client.finish(owner),
  };
}

export function measurementOwnershipAvailable() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
    return typeof native.measurementOwnership === 'function';
  } catch { return false; }
}

export const MeasurementSessions = createMeasurementSessions(MeasurementOwnership, async () => {
  // Lazy to preserve compatibility with existing Running-only binaries and focused tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const reader = require('../../modules/legacy-storage-reader').default as typeof import('../../modules/legacy-storage-reader').default;
  const [running, cycling] = await Promise.all([
    reader.activityMetadata('running', 'draft', 1), reader.activityMetadata('cycling', 'draft', 1),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const location = require('expo-location') as typeof import('expo-location');
  const registrations = await Promise.all(['runjourney-background-location', 'runjourney-cycling-location']
    .map(task => location.hasStartedLocationUpdatesAsync(task)));
  return { running: running.rows[0] ?? null, cycling: cycling.rows[0] ?? null,
    trackingPurposes: (['running', 'cycling'] as const).filter((_purpose, index) => registrations[index]),
    unownedTracking: !running.rows.length && !cycling.rows.length && registrations.some(Boolean) };
}, {
  async completed(owner) {
    if (owner.purpose !== 'running' && owner.purpose !== 'cycling') return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reader = require('../../modules/legacy-storage-reader').default as typeof import('../../modules/legacy-storage-reader').default;
    const result = await reader.activityRecordHeader(owner.purpose, owner.sessionId);
    const record = result.rows[0];
    return result.exists && result.rows.length === 1 && record.id === owner.sessionId
      && Date.parse(record.startedAt) === owner.startedAt && record.endedAt !== null
      && Number.isFinite(Date.parse(record.endedAt)) && Date.parse(record.endedAt) >= owner.startedAt;
  },
  async stopTracking(purpose) {
    if (purpose !== 'running' && purpose !== 'cycling') throw Error('この用途の終了復旧には未対応です');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const location = require('expo-location') as typeof import('expo-location');
    const task = purpose === 'running' ? 'runjourney-background-location' : 'runjourney-cycling-location';
    if (await location.hasStartedLocationUpdatesAsync(task)) await location.stopLocationUpdatesAsync(task);
    if (await location.hasStartedLocationUpdatesAsync(task)) throw Error('保存済みですがGPS停止を確認できません。所有権を保持しています');
  },
});
