// Existing iOS/web storage remains unchanged. Android resolves storage.android.ts.
import { database } from './database';
/** Settings only; run history and draft use the typed SQLite repository. */
export default {
  async getItem(key: string) { return (await database()).getSetting(key); },
  async setItem(key: string, value: string) { await (await database()).setSetting(key, value); },
  async removeItem(key: string) { await (await database()).setSetting(key, null); },
};
