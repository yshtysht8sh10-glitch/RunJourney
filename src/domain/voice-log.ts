import { savingsSeconds, spokenDuration } from './voice-guidance';
/** Recompute from captured operands, never from the current run. null means unavailable. */
export function verifyVoiceLog(text: string) {
  const entries = JSON.parse(text) as { id?: string; message?: string; data?: Record<string, unknown> }[];
  return entries.map(e => {
    const d = e.data ?? {};
    const number = (key: string) => typeof d[key] === 'number' && Number.isFinite(d[key]) ? d[key] as number : null;
    const distance = number('distanceMeters'), active = number('activeMs'), target = number('targetPaceSecPerKm');
    const savings = number('cumulativeSavingsSec'), lap = number('lapMs'), lapSavings = number('lapSavingsSec');
    const marathon = number('marathonPredictionSec');
    const spokenPace = number('spokenPaceSecPerKm'), spokenMarathon = number('spokenMarathonSec');
    // Lap payload overrides the boundary clock. All-run projection retains its snapshot operands.
    const projectionDistance = number('snapshotDistanceMeters') ?? distance;
    const projectionActive = number('snapshotActiveMs') ?? active;
    const snapshotActive = number('snapshotActiveMs') ?? active;
    const elapsed = number('elapsedMs'), stopped = number('stoppedMs');
    type Edge = { startMs: number; endMs: number; startDistanceMeters: number; distanceMeters: number };
    const boundary = (edge: unknown, meters: number) => {
      const e = edge as Edge | null;
      return e && [e.startMs, e.endMs, e.startDistanceMeters, e.distanceMeters].every(Number.isFinite) && e.distanceMeters > 0
        ? e.startMs + (e.endMs - e.startMs) * (meters - e.startDistanceMeters) / e.distanceMeters : null;
    };
    const km = number('km');
    const endBoundary = km === null ? null : boundary(d.endBoundary, km * 1000);
    const startBoundary = km === 1 ? 0 : km === null ? null : boundary(d.startBoundary, (km - 1) * 1000);
    return { id: e.id ?? null,
      savingsCorrect: distance !== null && active !== null && target !== null && savings !== null ? Math.abs(savingsSeconds(distance, active, target) - savings) < 0.001 : null,
      lapTimeCorrect: lap !== null && endBoundary !== null && startBoundary !== null ? Math.abs(endBoundary - startBoundary - lap) < 0.001 : null,
      lapSavingsCorrect: lap !== null && target !== null && lapSavings !== null ? Math.abs(target - lap / 1000 - lapSavings) < 0.001 : null,
      stoppedTimeExcluded: elapsed !== null && stopped !== null && snapshotActive !== null ? Math.abs(elapsed - stopped - snapshotActive) < 0.001 : null,
      marathonCorrect: marathon !== null && projectionDistance !== null && projectionDistance > 0 && projectionActive !== null ? Math.abs(projectionActive / projectionDistance * 42.195 - marathon) < 0.001 : null,
      speechLapTimeCorrect: lap === null || !e.message ? null : e.message.includes(`今回のラップは${spokenDuration(lap / 1000)}。`),
      spokenPaceMarathonConsistent: spokenPace !== null && spokenMarathon !== null ? Math.abs(spokenPace * 42.195 - spokenMarathon) < 0.001 : null,
      paceComparison: 'Current = rolling 30s GPS; marathon = all-run active time. Equality is not required.' };
  });
}
