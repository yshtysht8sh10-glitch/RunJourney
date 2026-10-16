import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { RunRecord } from "../types/run";
import { effectiveRun } from "../utils/run-model";
import { canonical } from "../utils/run-backup-canonical";

export const PAGE_ROWS = 128;
export const PAGE_BYTES = 64 * 1024;
export const STREAMS = [
  "gps",
  "events",
  "metadata",
  "operations",
  "diagnostics",
] as const;
export type StreamKind = (typeof STREAMS)[number];
export type Counts = Record<StreamKind, number>;
export type RunSummary = {
  kind: "run-summary";
  id: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  originalDistanceMeters: number;
  activeRunningTime: number;
  wallClockElapsed: number;
  pointCount: number;
  counts: Counts;
  trashedAt?: number;
  error?: string;
};
export type RunPage = {
  kind: StreamKind;
  start: number;
  next: number;
  items: unknown[];
};
export type PagedRunSource = {
  summary(): Promise<RunSummary>;
  read(kind: StreamKind, start: number): Promise<RunPage>;
};
export const hashText = (text: string) =>
  bytesToHex(sha256(new TextEncoder().encode(text)));
export const emptyCounts = (): Counts => ({
  gps: 0,
  events: 0,
  metadata: 0,
  operations: 0,
  diagnostics: 0,
});
export function validateSummary(s: RunSummary) {
  if (
    !s ||
    s.kind !== "run-summary" ||
    typeof s.id !== "string" ||
    !s.id.trim() ||
    s.id.length > 256 ||
    !Number.isFinite(Date.parse(s.startedAt)) ||
    Date.parse(s.endedAt) < Date.parse(s.startedAt) ||
    !Number.isFinite(Date.parse(s.endedAt)) ||
    !Number.isFinite(s.distanceMeters) ||
    s.distanceMeters < 0 ||
    !Number.isFinite(s.wallClockElapsed) ||
    s.wallClockElapsed !== Date.parse(s.endedAt) - Date.parse(s.startedAt) ||
    !Number.isFinite(s.activeRunningTime) ||
    s.activeRunningTime < 0 ||
    s.activeRunningTime > s.wallClockElapsed ||
    !Number.isFinite(s.originalDistanceMeters) ||
    s.originalDistanceMeters < 0 ||
    !s.counts ||
    STREAMS.some(
      (k) => !Number.isSafeInteger(s.counts[k]) || s.counts[k] < 0,
    ) ||
    s.counts.gps !== s.pointCount
  )
    throw new Error("走行メタデータの形式が不正です");
}
export function checkPage(
  page: RunPage,
  summary: RunSummary,
  kind: StreamKind,
  start: number,
) {
  if (
    !page ||
    page.kind !== kind ||
    page.start !== start ||
    !Array.isArray(page.items) ||
    page.items.length < 1 ||
    page.items.length > PAGE_ROWS ||
    page.next !== start + page.items.length ||
    page.next > summary.counts[kind] ||
    new TextEncoder().encode(canonical(page)).byteLength > PAGE_BYTES
  )
    throw new Error(
      `ページ順序・点数・容量異常: ${summary.id}/${kind}/${start}`,
    );
}
export function packPage(
  kind: StreamKind,
  start: number,
  rows: unknown[],
): RunPage {
  const items: unknown[] = [];
  let bytes = 128;
  for (const row of rows.slice(0, PAGE_ROWS)) {
    const size = new TextEncoder().encode(canonical(row)).byteLength + 1;
    if (bytes + size > PAGE_BYTES) {
      if (!items.length)
        throw new Error("単一レコードがページ上限を超えています");
      break;
    }
    items.push(row);
    bytes += size;
  }
  return { kind, start, next: start + items.length, items };
}
export async function* iteratePages(source: PagedRunSource, kind: StreamKind) {
  const summary = await source.summary();
  validateSummary(summary);
  if (summary.error) throw new Error(summary.error);
  for (let start = 0; start < summary.counts[kind]; ) {
    const page = await source.read(kind, start);
    checkPage(page, summary, kind, start);
    yield page;
    start = page.next;
  }
}
// Legacy small-file/sample bridge only. Streaming Native/cloud paths never call this.
export function sourceFromRun(run: RunRecord): PagedRunSource {
  const split = (value: unknown) => {
    if (value === undefined) return [];
    const text = canonical(value),
      out: string[] = [];
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + 8192, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      out.push(text.slice(start, end));
      start = end;
    }
    return out;
  };
  const { points, events, diagnostics, recovery, stopOverrides, ...metadata } =
    run;
  const values: Record<StreamKind, unknown[]> = {
    gps: points,
    events: events ?? [],
    diagnostics: split(diagnostics),
    metadata: split({
      ...metadata,
      _sqlitePresence: {
        events: events !== undefined,
        diagnostics: diagnostics !== undefined,
        points: points.length,
        eventCount: events?.length ?? 0,
      },
    }),
    operations:
      recovery !== undefined || stopOverrides !== undefined
        ? split({ recovery, stopOverrides })
        : [],
  };
  const effective = effectiveRun(run, Date.parse(run.endedAt));
  const summary: RunSummary = {
    kind: "run-summary",
    id: run.id,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    distanceMeters: effective.distanceMeters,
    originalDistanceMeters: run.distanceMeters,
    activeRunningTime: effective.activeRunningTime,
    wallClockElapsed: effective.wallClockElapsed,
    pointCount: points.length,
    counts: Object.fromEntries(
      STREAMS.map((k) => [k, values[k].length]),
    ) as Counts,
    ...(run.trashedAt === undefined ? {} : { trashedAt: run.trashedAt }),
  };
  return {
    summary: async () => summary,
    read: async (kind, start) =>
      packPage(kind, start, values[kind].slice(start, start + PAGE_ROWS)),
  };
}
