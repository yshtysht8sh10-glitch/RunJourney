import type { LocationObject } from 'expo-location';
import type { AppStateStatus } from 'react-native';

/** PC test input only. No file access, app switch, native GPS or device database. */
export type ReplayBatch = { receivedAt: number; appState: AppStateStatus; locations: LocationObject[] };
export class GpsBatchReplay {
  private index = 0;
  paused = false;
  now: number;
  private readonly batches: ReplayBatch[];
  constructor(batches: readonly ReplayBatch[], startedAt: number) {
    if (!Number.isFinite(startedAt) || batches.length > 20000) throw Error('REPLAY_INPUT_LIMIT_OR_CLOCK');
    let last = startedAt, count = 0;
    this.batches = batches.map(batch => {
      count += batch.locations.length;
      if (!Number.isFinite(batch.receivedAt) || batch.receivedAt < last || count > 100000) throw Error('REPLAY_INPUT_LIMIT_OR_CLOCK');
      last = batch.receivedAt;
      // Preserve receive/batch/fix order, duplicate and delayed fixes. The real
      // adapter performs its own admission; replay must not pre-sort/filter it.
      return { ...batch, locations: batch.locations.map(fix => ({ ...fix, coords: { ...fix.coords } })) };
    });
    this.now = startedAt;
  }
  step(): ReplayBatch | undefined {
    if (this.paused || this.index >= this.batches.length) return undefined;
    const batch = this.batches[this.index++]; this.now = batch.receivedAt;
    return { ...batch, locations: batch.locations.map(fix => ({ ...fix, coords: { ...fix.coords } })) };
  }
}
