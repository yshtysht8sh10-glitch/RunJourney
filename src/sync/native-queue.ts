import Storage from '../repositories/storage';
import { RunRepository } from '../repositories/run-repository';
import { PagedSyncQueue } from './paged-protocol';
import { firebasePagedTransport, syncClient } from './firebase';
import type { CloudMode } from './firebase-config';

// One queue instance per destination/owner, including after screen navigation.
// PagedSyncQueue serializes open/enqueue/flush so a second screen cannot lose writes.
const queues = new Map<string, PagedSyncQueue>();
export async function nativeQueue(mode: CloudMode, host: string, owner: string) {
  const client = syncClient(mode, host);
  if (client.auth.currentUser?.uid !== owner) throw new Error('認証ユーザーが一致しません');
  const key = `@runjourney/sync/paged-v2/${mode}/${client.auth.app.options.projectId}/${owner}`;
  let queue = queues.get(key);
  if (!queue) {
    queue = new PagedSyncQueue(owner, {
      load: () => Storage.getItem(key),
      save: value => Storage.setItem(key, value),
    }, RunRepository.pagedSource, firebasePagedTransport(client, owner));
    queues.set(key, queue);
  }
  await queue.open();
  return queue;
}
