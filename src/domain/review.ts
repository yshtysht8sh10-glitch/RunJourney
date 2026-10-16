import { RunRecord } from "../types/run";
import { effectiveRun } from "../utils/run-model";
import {
  validateRuns,
  parseBackup,
  MAX_BACKUP_BYTES,
} from "../utils/run-backup";
import { analyzePace } from "../utils/pace-analysis";

// Pure shared projections. Original RunRecord, GPS and edit operations are never mutated.
export function eligible(run: RunRecord) {
  return (
    run.trashedAt === undefined &&
    Number.isFinite(run.distanceMeters) &&
    run.distanceMeters >= 0 &&
    Number.isFinite(Date.parse(run.startedAt)) &&
    Date.parse(run.endedAt) >= Date.parse(run.startedAt)
  );
}
export function runMetrics(run: RunRecord) {
  return effectiveRun(run, Date.parse(run.endedAt));
}
export function statistics(runs: RunRecord[]) {
  const active = runs.filter(eligible),
    metrics = active.map(runMetrics);
  const distanceMeters = metrics.reduce((sum, m) => sum + m.distanceMeters, 0);
  const activeRunningTime = metrics.reduce(
    (sum, m) => sum + m.activeRunningTime,
    0,
  );
  return {
    count: active.length,
    activeRunningTime,
    ...analyzePace(0, activeRunningTime, distanceMeters),
  };
}
export function dayKey(time: string | number, timeZone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function shiftDay(day: string, delta: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000)
    .toISOString()
    .slice(0, 10);
}
// Cross-midnight runs belong to their START day, in the selected display timezone.
export function dailyDistances(runs: RunRecord[], timeZone = "Asia/Tokyo") {
  const days = new Map<string, number>();
  runs.filter(eligible).forEach((run) => {
    const day = dayKey(run.startedAt, timeZone);
    days.set(day, (days.get(day) ?? 0) + runMetrics(run).distanceMeters);
  });
  return days;
}
export function groupedDistances(
  days: Map<string, number>,
  unit: "day" | "week" | "month",
) {
  const groups = new Map<string, number>();
  [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([day, meters]) => {
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      const key =
        unit === "month"
          ? day.slice(0, 7)
          : unit === "week"
            ? shiftDay(day, -((weekday + 6) % 7))
            : day;
      groups.set(key, (groups.get(key) ?? 0) + meters);
    });
  return [...groups].map(([day, meters]) => ({ day, meters }));
}
export const JOURNEY = {
  multiplier: 100,
  milestones: [
    { name: "静岡", kilometers: 0, icon: "◉" },
    { name: "モルディブ", kilometers: 7200, icon: "◇" },
    { name: "地球を一周", kilometers: 40075, icon: "◎" },
    { name: "月", kilometers: 384400, icon: "☾" },
  ],
};
export function journey(runs: RunRecord[], config = JOURNEY) {
  if (
    !Number.isFinite(config.multiplier) ||
    config.multiplier <= 0 ||
    config.milestones.length < 2 ||
    config.milestones[0].kilometers !== 0 ||
    config.milestones.some(
      (m, i, a) =>
        !Number.isFinite(m.kilometers) ||
        m.kilometers < 0 ||
        (i > 0 && m.kilometers <= a[i - 1].kilometers),
    )
  )
    throw new Error("Journey設定が不正です");
  const actualKm = statistics(runs).distanceMeters / 1000,
    traveledKm = actualKm * config.multiplier;
  const reached = config.milestones.filter((m) => m.kilometers <= traveledKm),
    next = config.milestones.find((m) => m.kilometers > traveledKm);
  return {
    actualKm,
    traveledKm,
    reached,
    current: reached.at(-1)!,
    next,
    remainingKm: next ? (next.kilometers - traveledKm) / config.multiplier : 0,
    progress: Math.min(1, traveledKm / config.milestones.at(-1)!.kilometers),
  };
}
export function streak(
  runs: RunRecord[],
  options: { now?: number; timeZone?: string; thresholdMeters?: number } = {},
) {
  const {
    now = Date.now(),
    timeZone = "Asia/Tokyo",
    thresholdMeters = 1000,
  } = options;
  if (!Number.isFinite(thresholdMeters) || thresholdMeters <= 0)
    throw new Error("Streak達成距離が不正です");
  const today = dayKey(now, timeZone),
    days = dailyDistances(runs, timeZone);
  const achieved = [...days]
    // Haversine floating point error at exactly 1km must not lose a day.
    .filter(([day, meters]) => day <= today && meters + 1e-6 >= thresholdMeters)
    .map(([day]) => day)
    .sort();
  const set = new Set(achieved);
  let best = 0,
    length = 0,
    previous = "";
  achieved.forEach((day) => {
    length = shiftDay(previous || day, 1) === day ? length + 1 : 1;
    best = Math.max(best, length);
    previous = day;
  });
  let cursor = set.has(today) ? today : shiftDay(today, -1),
    current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = shiftDay(cursor, -1);
  }
  return {
    current,
    best,
    todayAchieved: set.has(today),
    remainingMeters: set.has(today)
      ? 0
      : Math.max(0, thresholdMeters - (days.get(today) ?? 0)),
    thresholdMeters,
    calendar: Array.from({ length: 35 }, (_, i) => {
      const day = shiftDay(today, i - 34);
      return { day, achieved: set.has(day), meters: days.get(day) ?? 0 };
    }),
  };
}
export function uniqueRuns(runs: RunRecord[]) {
  const map = new Map<string, RunRecord>();
  runs.forEach((run) => {
    const prior = map.get(run.id);
    if (prior && canonical(prior) !== canonical(run))
      throw new Error(`Run ID衝突: ${run.id}`);
    map.set(run.id, run);
  });
  return [...map.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
}
export function canonical(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, stable(item)]),
          )
        : v;
  return JSON.stringify(stable(value));
}
export async function parseReviewFile(
  text: string,
  digest: (text: string) => Promise<string>,
) {
  if (text.length > MAX_BACKUP_BYTES) throw new Error("ファイル上限は50MBです");
  const value = JSON.parse(text);
  if (value?.format === "runjourney-backup")
    return { runs: uniqueRuns(parseBackup(text).runs), diagnostic: null };
  if (value?.format === "runjourney-sqlite-backup") {
    // Import only completed history. Draft/settings remain exclusively Native data.
    const { decodeBackup } = await import("../repositories/sqlite-backup");
    const backup = await decodeBackup(text, digest);
    return { runs: uniqueRuns(backup.snapshot.runs), diagnostic: null };
  }
  if (value?.runId && Array.isArray(value.actualEvents) && value.schema === 2) {
    if (value.actualEvents.length > 100000 || typeof value.runId !== "string")
      throw new Error("診断形式が不正です");
    return { runs: null, diagnostic: value as Record<string, unknown> };
  }
  const runs = Array.isArray(value) ? value : [value];
  validateRuns(runs);
  return { runs: uniqueRuns(runs), diagnostic: null };
}
