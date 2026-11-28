import type { CyclingDraft } from '@/repositories/cycling-recorder';
import { cyclingVoiceBatch, CYCLING_VOICE_INTERVAL_MS } from '@/domain/cycling-voice';
import { MeasurementOwnership } from './measurement-ownership';
import { timeModel } from '@/utils/run-model';

let activeId: string | null = null;
let lastStamp = '';
let queue: Promise<unknown> = Promise.resolve();
function native() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}
/** Reuses the common chime/focus/queue/durable Native dedup IDs, with Cycling-only renderers.
 * Bridge submission is not completion or proof of audibility. Failures never undo GPS saves.
 */
export const CyclingVoice = {
  update(run: CyclingDraft, now = Date.now()): Promise<void> {
    const work = queue.then(async () => {
      const owner = (await MeasurementOwnership.read()).binding;
      if (!owner || owner.purpose !== 'cycling' || owner.sessionId !== run.id || owner.status !== 'ACTIVE') return;
      if (run.endedAt || !run.cyclingSettings.voice && activeId === run.id) return;
      const stamp = `${run.id}:${run.points.length}:${run.events?.length ?? 0}:${Math.floor(timeModel(run, now).activeRunningTime / CYCLING_VOICE_INTERVAL_MS)}`;
      if (stamp === lastStamp) return;
      const bridge = native();
      if (activeId !== run.id) {
        if (run.cyclingSettings.voice) bridge.start(Date.parse(run.startedAt), CYCLING_VOICE_INTERVAL_MS);
      }
      await bridge.notifyBatch?.(JSON.stringify(cyclingVoiceBatch(run, now)));
      activeId = run.id; lastStamp = stamp;
    });
    queue = work.catch(() => undefined); return work;
  },
  stop(run: CyclingDraft): Promise<void> {
    const work = queue.then(async () => {
      // Scoped ended packet; never issue the unscoped global stop against a new sport.
      await native().notifyBatch?.(JSON.stringify(cyclingVoiceBatch({ ...run, endedAt: run.endedAt ?? new Date().toISOString() }, Date.now())));
      activeId = null; lastStamp = '';
    });
    queue = work.catch(() => undefined); return work;
  },
};
