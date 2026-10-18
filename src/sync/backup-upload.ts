import type { PagedRunSource } from '../domain/pages';
import type { PagedRemote } from './paged-protocol';
import { PagedSyncQueue } from './paged-protocol';
import type { QueueStore } from './protocol';

// The staging catalog and queue belong to one account. Neither source files nor
// the phone DB are ever written. A reload can resume from the staged pages.
export function backupUploadQueue(uid: string, store: QueueStore, open: (id: string) => Promise<PagedRunSource>, remote: PagedRemote) {
  const sources = new Map<string, Promise<PagedRunSource>>();
  const source = (id: string): PagedRunSource => {
    const get = () => {
      if (!sources.has(id)) sources.set(id, open(id).catch(error => { sources.delete(id); throw error; }));
      return sources.get(id)!;
    };
    return { summary: async () => (await get()).summary(), read: async (kind, start) => (await get()).read(kind, start) };
  };
  return new PagedSyncQueue(uid, store, source, remote);
}
