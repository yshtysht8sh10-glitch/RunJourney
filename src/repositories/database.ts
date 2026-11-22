import * as SQLite from 'expo-sqlite';
import { DATABASE_NAME, SqliteStore } from './sqlite-store';

let opening: Promise<SqliteStore> | undefined;
export function database(): Promise<SqliteStore> {
  if (!opening) opening = SQLite.openDatabaseAsync(DATABASE_NAME).then(async db => {
    const store = new SqliteStore(db); await store.atomic(async () => undefined); return store;
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}
