import {
  canonical,
  dailyDistances,
  dayKey,
  groupedDistances,
  journey,
  JOURNEY,
  parseReviewFile,
  runMetrics,
  statistics,
  streak,
  uniqueRuns,
} from "../../domain/review";
import { demoRuns } from "../../web/demo";
import { RunRecord } from "../../types/run";
import { createHash } from "crypto";
import { serializeBackup } from "../run-backup";
const digest = async (text: string) =>
  createHash("sha256").update(text).digest("hex");
const now = Date.parse("2026-10-17T03:00:00Z");
function run(day: string, meters = 1000, id = day): RunRecord {
  // A constant-speed two-fix synthetic edge: physical distance is derived by shared GPS math.
  const start = Date.parse(`${day}T00:00:00Z`),
    latitude = ((meters / 6371000) * 180) / Math.PI;
  return {
    id,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + 600000).toISOString(),
    distanceMeters: meters,
    createdAt: "",
    updatedAt: "",
    points: [
      { latitude: 0, longitude: 0, timestamp: start, accuracy: 5 },
      { latitude, longitude: 0, timestamp: start + 600000, accuracy: 5 },
    ],
  };
}
describe("read-only review shared domain", () => {
  it("empty statistics, journey and streak", () => {
    expect(statistics([]).distanceMeters).toBe(0);
    expect(journey([]).current.name).toBe("静岡");
    expect(streak([], { now }).current).toBe(0);
  });
  it("uses the same effective GPS metrics as Native, never the stale saved total", () => {
    const r = { ...run("2026-10-17"), distanceMeters: 9999 };
    expect(statistics([r]).distanceMeters).toBeCloseTo(1000);
    expect(runMetrics(r).activeRunningTime).toBe(600000);
  });
  it("does not mutate original data during every projection", () => {
    const runs = demoRuns(now);
    const before = canonical(runs);
    statistics(runs);
    dailyDistances(runs);
    journey(runs);
    streak(runs, { now });
    runs.forEach(runMetrics);
    expect(canonical(runs)).toBe(before);
  });
  it("excludes trash and invalid distances", () => {
    expect(
      statistics([
        { ...run("2026-10-17"), trashedAt: now },
        run("2026-10-16", NaN),
      ]).count,
    ).toBe(0);
  });
  it("recalculates journey on addition/removal, multiplier and milestone arrival", () => {
    const config = {
      ...JOURNEY,
      multiplier: 100,
      milestones: [
        { name: "静岡", kilometers: 0, icon: "" },
        { name: "モルディブ", kilometers: 99, icon: "" },
        { name: "月", kilometers: 199, icon: "" },
      ],
    };
    expect(journey([run("2026-10-16")], config).current.name).toBe(
      "モルディブ",
    );
    expect(
      journey([run("2026-10-16"), run("2026-10-17")], config).progress,
    ).toBe(1);
    expect(
      journey([run("2026-10-16")], { ...config, multiplier: 1 }).current.name,
    ).toBe("静岡");
  });
  it("rejects invalid journey settings", () => {
    expect(() => journey([], { ...JOURNEY, multiplier: 0 })).toThrow();
  });
  it("sums multiple runs on a day and meets the exact 1km boundary", () => {
    const runs = [run("2026-10-17", 500, "a"), run("2026-10-17", 500, "b")];
    expect(streak(runs, { now, thresholdMeters: 999.999 }).todayAchieved).toBe(
      true,
    );
    expect(streak([run("2026-10-17", 100)], { now }).todayAchieved).toBe(false);
  });
  it("exact 1km qualifies, 999m does not", () => {
    expect(streak([run("2026-10-17", 1000)], { now }).todayAchieved).toBe(true);
    expect(streak([run("2026-10-17", 999)], { now }).todayAchieved).toBe(false);
  });
  it("preserves yesterday streak when today is unfinished", () => {
    expect(
      streak([run("2026-10-16", 1001), run("2026-10-15", 1001)], { now })
        .current,
    ).toBe(2);
  });
  it("breaks on a missing day and calculates the historical best", () => {
    const runs = [10, 11, 12, 16].map((d) => run(`2026-10-${d}`, 1001));
    const value = streak(runs, { now });
    expect(value.current).toBe(1);
    expect(value.best).toBe(3);
  });
  it("ignores future days and trash", () => {
    const value = streak(
      [run("2026-10-18", 2000), { ...run("2026-10-17", 2000), trashedAt: now }],
      { now },
    );
    expect(value.best).toBe(0);
  });
  it("timezone includes DST without adding local 24-hour timestamps", () => {
    expect(dayKey("2026-11-01T07:30:00Z", "America/Los_Angeles")).toBe(
      "2026-11-01",
    );
    expect(dayKey("2026-10-17T00:30:00Z", "America/Los_Angeles")).toBe(
      "2026-10-16",
    );
  });
  it("cross-midnight run belongs to start day", () => {
    const r = run("2026-10-16", 1001);
    r.startedAt = "2026-10-16T14:55:00Z";
    r.endedAt = "2026-10-16T15:05:00Z";
    r.points[0].timestamp = Date.parse(r.startedAt);
    r.points[1].timestamp = Date.parse(r.endedAt);
    expect([...dailyDistances([r], "Asia/Tokyo").keys()]).toEqual([
      "2026-10-16",
    ]);
  });
  it("buckets Monday weeks and months", () => {
    const days = new Map([
      ["2026-10-17", 100],
      ["2026-10-18", 200],
    ]);
    expect(groupedDistances(days, "week")).toEqual([
      { day: "2026-10-12", meters: 300 },
    ]);
    expect(groupedDistances(days, "month")[0].meters).toBe(300);
  });
  it("accepts original backup, individual run and exact duplicate ids", async () => {
    const r = run("2026-10-17");
    expect(
      (await parseReviewFile(serializeBackup([r], {}, now), digest)).runs,
    ).toEqual([r]);
    expect((await parseReviewFile(JSON.stringify(r), digest)).runs).toEqual([
      r,
    ]);
    expect(uniqueRuns([r, r])).toHaveLength(1);
  });
  it("rejects malformed JSON, coordinates, conflicting ids and future schema", async () => {
    await expect(parseReviewFile("{", digest)).rejects.toThrow();
    await expect(
      parseReviewFile(
        JSON.stringify({ ...run("2026-10-17"), points: [{ latitude: 999 }] }),
        digest,
      ),
    ).rejects.toThrow();
    expect(() =>
      uniqueRuns([
        run("2026-10-17"),
        { ...run("2026-10-17"), distanceMeters: 3 },
      ]),
    ).toThrow("衝突");
    await expect(
      parseReviewFile(
        JSON.stringify({ format: "runjourney-backup", schemaVersion: 99 }),
        digest,
      ),
    ).rejects.toThrow();
  });
  it("accepts actual diagnostic reports without inventing GPS", async () => {
    const report = {
      schema: 2,
      runId: "diagnostic",
      actualEvents: [],
      buildHash: "test",
    };
    const result = await parseReviewFile(JSON.stringify(report), digest);
    expect(result.runs).toBeNull();
    expect(result.diagnostic).toEqual(report);
  });
});
