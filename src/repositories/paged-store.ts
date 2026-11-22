import type { SqlConnection, SqliteStore } from "./sqlite-store";
import {
  emptyCounts,
  hashText,
  packPage,
  PAGE_ROWS,
  PagedRunSource,
  RunSummary,
  StreamKind,
  STREAMS,
  validateSummary,
} from "../domain/pages";

export const PAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS run_stream_state(run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,points INTEGER NOT NULL,events INTEGER NOT NULL,error TEXT);
CREATE TABLE IF NOT EXISTS run_row_hash(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,kind TEXT NOT NULL,seq INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(run_id,kind,seq));
`;
class LegacyRunDataError extends Error {}
const tables: Record<StreamKind, { table: string; key: string }> = {
  gps: { table: "gps_points", key: "seq" },
  events: { table: "run_events", key: "seq" },
  metadata: { table: "run_metadata", key: "chunk" },
  operations: { table: "run_operations", key: "chunk" },
  diagnostics: { table: "run_diagnostics", key: "chunk" },
};
export async function stampRow(
  db: SqlConnection,
  id: string,
  kind: StreamKind,
  seq: number,
  payload: string,
) {
  await db.runAsync(
    "INSERT OR REPLACE INTO run_row_hash(run_id,kind,seq,hash) VALUES(?,?,?,?)",
    id,
    kind,
    seq,
    hashText(payload),
  );
}
export async function migratePageIndex(db: SqlConnection) {
  // Raw tables are NEVER rewritten. One bad legacy run gets an explicit catalog
  // error, while other metadata remains available. All DDL/backfill is atomic.
  let offset = 0;
  for (;;) {
    const ids = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM runs ORDER BY id LIMIT 64 OFFSET ?",
      offset,
    );
    if (!ids.length) break;
    for (const { id } of ids) {
      let points = 0,
        events = 0,
        error: string | null = null;
      try {
        const [sizes] = await db.getAllAsync<{ size: number }>(
          "SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) AS size FROM run_metadata WHERE run_id=?",
          id,
        );
        if (sizes.size > 8 * 1024 * 1024)
          throw new LegacyRunDataError(
            "旧メタデータが8MiB超のため個別救済が必要です",
          );
        const metadata: string[] = [];
        for (const kind of STREAMS) {
          const { table, key } = tables[kind];
          let cursor = 0;
          for (;;) {
            const rows = await db.getAllAsync<{ seq: number; payload: string }>(
              `SELECT ${key} AS seq,payload FROM ${table} WHERE run_id=? AND ${key}>=? ORDER BY ${key} LIMIT ?`,
              id,
              cursor,
              PAGE_ROWS,
            );
            if (!rows.length) break;
            for (const row of rows) {
              if (row.seq !== cursor)
                throw new LegacyRunDataError(
                  `旧データの順序・欠損異常: ${kind}/${cursor}`,
                );
              await stampRow(db, id, kind, row.seq, row.payload);
              if (kind === "metadata") metadata.push(row.payload);
              if (kind === "gps") {
                JSON.parse(row.payload);
                points++;
              }
              if (kind === "events") {
                JSON.parse(row.payload);
                events++;
              }
              cursor++;
            }
          }
        }
        const flags = JSON.parse(metadata.join(""))?._sqlitePresence;
        if (!flags || flags.points !== points || flags.eventCount !== events)
          throw new LegacyRunDataError(
            "旧GPS/イベントの期待件数と一致しません",
          );
      } catch (e) {
        if (!(e instanceof LegacyRunDataError) && !(e instanceof SyntaxError))
          throw e;
        error = `走行 ${id} の移行検証失敗: ${String(e)}`;
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO run_stream_state(run_id,points,events,error) VALUES(?,?,?,?)",
        id,
        points,
        events,
        error,
      );
    }
    offset += ids.length;
  }
}
type Header = {
  id: string;
  started_at: string;
  ended_at: string;
  distance: number;
  effective_distance: number;
  effective_time: number;
  trashed_at: number | null;
  points: number;
  events: number;
  error: string | null;
};
function summary(row: Header): RunSummary {
  return {
    kind: "run-summary",
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    distanceMeters: row.effective_distance,
    originalDistanceMeters: row.distance,
    activeRunningTime: row.effective_time,
    wallClockElapsed: Date.parse(row.ended_at) - Date.parse(row.started_at),
    pointCount: row.points,
    counts: { ...emptyCounts(), gps: row.points, events: row.events },
    ...(row.trashed_at === null ? {} : { trashedAt: row.trashed_at }),
    ...(row.error ? { error: row.error } : {}),
  };
}
export class SqlitePagedStore {
  constructor(readonly store: SqliteStore) {}
  list(limit = 100, offset = 0): Promise<RunSummary[]> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new Error("一覧ページ範囲が不正です");
    return this.store.atomic(async (s) =>
      (
        await s.db.getAllAsync<Header>(
          "SELECT r.*,i.points,i.events,i.error FROM runs r JOIN run_stream_state i ON i.run_id=r.id WHERE r.status='completed' ORDER BY r.started_at DESC,r.id LIMIT ? OFFSET ?",
          limit,
          offset,
        )
      ).map(summary),
    );
  }
  source(id: string): PagedRunSource {
    return {
      summary: () =>
        this.store.atomic(async (s) => {
          const [row] = await s.db.getAllAsync<Header>(
            "SELECT r.*,i.points,i.events,i.error FROM runs r JOIN run_stream_state i ON i.run_id=r.id WHERE r.id=? AND r.status='completed'",
            id,
          );
          if (!row) throw new Error(`走行メタデータが見つかりません: ${id}`);
          const result = summary(row);
          for (const kind of STREAMS) {
            const { table } = tables[kind];
            const [count] = await s.db.getAllAsync<{ total: number }>(
              `SELECT count(*) AS total FROM ${table} WHERE run_id=?`,
              id,
            );
            const [hashCount] = await s.db.getAllAsync<{ total: number }>(
              "SELECT count(*) AS total FROM run_row_hash WHERE run_id=? AND kind=?",
              id,
              kind,
            );
            if (count.total !== hashCount.total)
              throw new Error(`ページ行・検証件数不一致: ${id}/${kind}`);
            if (
              (kind === "gps" || kind === "events") &&
              count.total !== result.counts[kind]
            )
              throw new Error(`GPS/イベント件数不一致: ${id}/${kind}`);
            result.counts[kind] = count.total;
          }
          const [order] = await s.db.getAllAsync<{
            total: number;
            uniqueCount: number;
            first: number | null;
            last: number | null;
          }>(
            "SELECT count(*) AS total,count(DISTINCT seq) AS uniqueCount,min(position) AS first,max(position) AS last FROM gps_order WHERE run_id=?",
            id,
          );
          if (
            order.total !== row.points ||
            order.uniqueCount !== row.points ||
            (row.points > 0 &&
              (order.first !== 0 || order.last !== row.points - 1))
          )
            throw new Error(`GPS順序の欠損・重複: ${id}`);
          validateSummary(result);
          return result;
        }),
      read: (kind, start) => this.read(id, kind, start),
    };
  }
  read(id: string, kind: StreamKind, start: number) {
    if (!STREAMS.includes(kind) || !Number.isSafeInteger(start) || start < 0)
      throw new Error("ページ範囲が不正です");
    return this.store.atomic(async (s) => {
      const { table, key } = tables[kind];
      const rows =
        kind === "gps"
          ? await s.db.getAllAsync<{
              position: number;
              seq: number;
              payload: string;
              hash: string | null;
            }>(
              `SELECT o.position,p.seq,p.payload,h.hash FROM gps_order o JOIN gps_points p ON p.run_id=o.run_id AND p.seq=o.seq LEFT JOIN run_row_hash h ON h.run_id=p.run_id AND h.kind='gps' AND h.seq=p.seq WHERE o.run_id=? AND o.position>=? ORDER BY o.position LIMIT ?`,
              id,
              start,
              PAGE_ROWS,
            )
          : await s.db.getAllAsync<{
              position: number;
              seq: number;
              payload: string;
              hash: string | null;
            }>(
              `SELECT p.${key} AS position,p.${key} AS seq,p.payload,h.hash FROM ${table} p LEFT JOIN run_row_hash h ON h.run_id=p.run_id AND h.kind=? AND h.seq=p.${key} WHERE p.run_id=? AND p.${key}>=? ORDER BY p.${key} LIMIT ?`,
              kind,
              id,
              start,
              PAGE_ROWS,
            );
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (
          row.position !== start + i ||
          !row.hash ||
          hashText(row.payload) !== row.hash
        )
          throw new Error(
            `ページ欠損・順序・SHA-256異常: ${id}/${kind}/${start + i}`,
          );
      }
      const items = rows.map((row) =>
        kind === "gps" || kind === "events"
          ? JSON.parse(row.payload)
          : row.payload,
      );
      if (kind === "gps") {
        if (start > 0 && items.length) {
          const [prior] = await s.db.getAllAsync<{
            payload: string;
            hash: string;
          }>(
            "SELECT p.payload,h.hash FROM gps_order o JOIN gps_points p ON p.run_id=o.run_id AND p.seq=o.seq JOIN run_row_hash h ON h.run_id=p.run_id AND h.kind='gps' AND h.seq=p.seq WHERE o.run_id=? AND o.position=?",
            id,
            start - 1,
          );
          if (
            !prior ||
            hashText(prior.payload) !== prior.hash ||
            items[0].timestamp <= JSON.parse(prior.payload).timestamp
          )
            throw new Error(`GPSページ境界の欠損・逆順・重複: ${id}/${start}`);
        }
        for (let i = 0; i < items.length; i++) {
          const p = items[i];
          if (
            !Number.isFinite(p.latitude) ||
            Math.abs(p.latitude) > 90 ||
            !Number.isFinite(p.longitude) ||
            Math.abs(p.longitude) > 180 ||
            !Number.isFinite(p.timestamp)
          )
            throw new Error(`GPS座標異常: ${id}/${start + i}`);
          if (i && p.timestamp <= items[i - 1].timestamp)
            throw new Error(`GPS時刻の逆順・重複: ${id}/${start + i}`);
        }
      }
      return packPage(kind, start, items);
    });
  }
}
