import * as SQLite from 'expo-sqlite';
import { CYCLING_PROFILE } from '@/domain/measurement-profile';
import { SqliteStore } from './sqlite-store';
import { assertStorageCompatible } from './storage-compatibility';

let opening: Promise<SqliteStore> | undefined;
/** Fixed destination. Never replaces database(), which remains Running-only. */
export function cyclingDatabase(): Promise<SqliteStore> {
  if (!opening) opening = assertStorageCompatible()
    .then(() => SQLite.openDatabaseAsync('runjourney-cycling.sqlite'))
    .then(async db => {
      const store = new SqliteStore(db, CYCLING_PROFILE.distance);
      await store.initialize(); return store;
    }).catch(error => { opening = undefined; throw error; });
  return opening;
}
