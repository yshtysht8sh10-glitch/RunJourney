import type { RunRecord } from "../types/run";
export function syntheticRun(
  hours: number,
  intervalMs = 5000,
  id = `synthetic-${hours}h`,
): RunRecord {
  const start = Date.parse("2026-10-01T21:00:00Z"),
    duration = hours * 3600000;
  const points = Array.from(
    { length: Math.floor(duration / intervalMs) + 1 },
    (_, i) => ({
      latitude: 35 + Math.sin((i * intervalMs) / 300000) * 0.004,
      longitude:
        139 +
        ((i * intervalMs) / 1000) * (intervalMs <= 1000 ? 0.00004 : 0.00002),
      timestamp: start + i * intervalMs,
      accuracy: 5 + (i % 8),
      speed: (intervalMs <= 1000 ? 3.8 : 2.7) + Math.sin(i / 20) * 0.2,
      altitude: 12 + Math.sin(i / 50),
    }),
  );
  const events: NonNullable<RunRecord["events"]> = [];
  for (let t = 3600000; t < duration; t += 3600000) {
    events.push({
      timestamp: start + t,
      state: "AUTO_STOP",
      source: "sensor",
      confirmedAt: start + t + 5000,
    });
    events.push({
      timestamp: start + t + 20000,
      state: "RUNNING",
      source: "sensor",
      confirmedAt: start + t + 25000,
    });
  }
  const entries: NonNullable<RunRecord["diagnostics"]>["entries"] = Array.from(
    { length: Math.min(720, Math.floor(duration / 1000)) },
    (_, i) => ({
      timestamp:
        start +
        duration -
        (Math.min(720, Math.floor(duration / 1000)) - i) * 1000,
      state: "RUNNING",
      decision: "CONTINUE",
      accuracy: 6,
      speed: 2.7,
      intervalMs: 1000,
    }),
  );
  return {
    id,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + duration).toISOString(),
    createdAt: "",
    updatedAt: "",
    distanceMeters: hours * 9000,
    points,
    events,
    features: { autoStop: true, break: true },
    diagnostics: {
      entries,
      trace: Array.from(
        { length: Math.min(4096, Math.floor(duration / 20000)) },
        (_, i) => ({
          timestamp:
            start +
            duration -
            (Math.min(4096, Math.floor(duration / 20000)) - i) * 20000,
          state: "RUNNING",
          decision: i % 2 ? "RESET" : "START",
          ...(i % 2 ? { reason: "SPEED_TOO_HIGH" as const } : {}),
          accuracy: 6,
          speed: i % 2 ? 2.7 : 0.2,
        }),
      ),
      counts: { GPS_OBS_RECEIVED: Math.floor(duration / 1000) },
      processed: Math.floor(duration / 1000),
    },
  };
}
