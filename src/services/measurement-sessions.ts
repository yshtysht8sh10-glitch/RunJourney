import type { MeasurementPurpose } from '@/domain/measurement-profile';
import { createMeasurementOwnership, MeasurementOwnership, type MeasurementBinding } from './measurement-ownership';

type DraftHeader = { id: string; startedAt: string; endedAt: string | null };
export type DraftInspection = { running: DraftHeader | null; cycling: DraftHeader | null; unownedTracking: boolean };
type Client = ReturnType<typeof createMeasurementOwnership>;

/** No mutable selected-sport global. A bound ID/destination survives route changes.
 * Inspection is read-only and never clears competing drafts or unowned GPS registrations.
 */
export function createMeasurementSessions(client: Client, inspect: () => Promise<DraftInspection>) {
  const reconcile = async (): Promise<MeasurementBinding | null> => {
    const current = await client.read();
    const drafts = await inspect();
    if (drafts.running && drafts.cycling) throw Error('両競技に未終了記録があります。新規開始せず確認してください');
    const kind = drafts.running ? 'running' : drafts.cycling ? 'cycling' : null;
    const draft = drafts.running ?? drafts.cycling;
    if (current.binding) {
      if (draft && (current.binding.purpose !== kind || current.binding.sessionId !== draft.id)) throw Error('計測所有権と未終了記録が一致しません');
      return current.binding;
    }
    if (!draft || !kind) {
      if (drafts.unownedTracking) throw Error('所有者を確認できないGPS計測があります。新規開始を停止しています');
      return null;
    }
    const startedAt = Date.parse(draft.startedAt);
    if (!Number.isFinite(startedAt)) throw Error('未終了記録の開始日時を確認できません');
    const adopted = await client.claim(kind, draft.id, startedAt);
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
    unownedTracking: !running.rows.length && !cycling.rows.length && registrations.some(Boolean) };
});
