/// <reference types="node" />
// PC tests only: executes the production SQL against Node's native SQLite.
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA, SCHEMA_VERSION, SqlConnection } from '../repositories/sqlite-store';

let native = new DatabaseSync(':memory:');
export let fault: ((sql: string) => void) | undefined;
export const trace: string[] = [];
export function resetNative() {
  native.close(); native = new DatabaseSync(':memory:'); fault = undefined; trace.length = 0;
  native.exec(`PRAGMA foreign_keys=ON; ${SCHEMA} PRAGMA user_version=${SCHEMA_VERSION};`);
}
resetNative();
export function injectFault(fn?: (sql: string) => void) { fault = fn; }
export const connection: SqlConnection = {
  async execAsync(sql) { trace.push(sql); fault?.(sql); native.exec(sql); },
  async runAsync(sql, ...params) { trace.push(sql); fault?.(sql); return native.prepare(sql).run(...params); },
  async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) { trace.push(sql); fault?.(sql); return native.prepare(sql).all(...params) as T[]; },
};
