import { RunRecord } from "../types/run";
// Synthetic loop near a public park. Never sourced from a personal backup.
export function demoRuns(now = Date.now()): RunRecord[] {
  return Array.from({ length: 18 }, (_, i) => {
    const start = new Date(now - i * 86400000 - 3600000);
    start.setUTCHours(21, 0, 0, 0);
    const points = Array.from({ length: 241 }, (_, j) => ({
      latitude: 34.975 + Math.sin((j / 240) * Math.PI * 4) * 0.005,
      longitude: 138.383 + Math.cos((j / 240) * Math.PI * 4) * 0.007,
      timestamp: start.getTime() + j * 5000,
      accuracy: 5 + (j % 9),
      speed: 2.8 + Math.sin(j / 12) * 0.3,
    }));
    return {
      id: `synthetic-${i + 1}`,
      startedAt: start.toISOString(),
      endedAt: new Date(points.at(-1)!.timestamp).toISOString(),
      createdAt: start.toISOString(),
      updatedAt: start.toISOString(),
      distanceMeters: 7800,
      points,
      events: [
        {
          timestamp: start.getTime() + 400000,
          state: "AUTO_STOP",
          source: "sensor",
        },
        {
          timestamp: start.getTime() + 420000,
          state: "RUNNING",
          source: "sensor",
        },
      ],
      diagnostics: {
        processed: 1,
        counts: { STOP_CONFIRMED: 1 },
        entries: [
          {
            timestamp: start.getTime() + 400000,
            state: "AUTO_STOP",
            decision: "STOP_CONFIRMED",
            accuracy: 6,
            speed: 0.2,
          },
        ],
      },
    };
  });
}
