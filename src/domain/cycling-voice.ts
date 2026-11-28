import { CYCLING_PROFILE } from './measurement-profile';
import { effectiveRun, stateOf, timeModel } from '@/utils/run-model';
import { formatAnnouncement, DEFAULT_VOICE_ITEMS } from '@/utils/voice-format';
import { analyzePace } from '@/utils/pace-analysis';
import type { CyclingDraft } from '@/repositories/cycling-recorder';

export const CYCLING_VOICE_INTERVAL_MS = 300000;
export const cyclingVoiceId = (id: string) => `cycling:${id}`;
export function cyclingReport(activeMs: number, meters: number) {
  return formatAnnouncement(activeMs, meters, analyzePace(0, activeMs, meters),
    { ...DEFAULT_VOICE_ITEMS, speed: true }).replace('時速', '平均時速');
}
export function cyclingVoiceBatch(run: CyclingDraft, now: number) {
  const runId = cyclingVoiceId(run.id), state = stateOf(run), time = timeModel(run, now);
  const sampledAt = run.points.at(-1)?.timestamp ?? Date.parse(run.startedAt);
  const effective = effectiveRun(run, now, CYCLING_PROFILE.distance);
  const data = { runId, activity: 'cycling', sampledAt: now, distanceMeters: effective.distanceMeters,
    activeMs: time.activeRunningTime, elapsedMs: time.wallClockElapsed, state };
  const notices: { id: string; type: string; priority: number; generatedAt: number; scheduledAt: number; expiresAt: number;
    message: string; data: Record<string, unknown> }[] = [];
  const add = (key: string, type: string, message: string, at: number, priority: number, eventIndex?: number) => {
    notices.push({ id: `${runId}:${key}`, type, message, priority, generatedAt: now, scheduledAt: at,
      expiresAt: now + 20000, data: { ...data, ...(eventIndex === undefined ? {} : { eventIndex }) } });
  };
  if (!run.endedAt && run.cyclingSettings.voice) {
    // Only a GPS-confirmed effective boundary is eligible; no speculative future distance.
    const verifiedActive = timeModel(run, sampledAt).activeRunningTime;
    const due = Math.floor(verifiedActive / CYCLING_VOICE_INTERVAL_MS);
    if (due >= 1 && now - sampledAt <= 15000 && state === 'RUNNING') {
      const endMs = due * CYCLING_VOICE_INTERVAL_MS, total = effective.lap(0, endMs);
      add(`five:${due}`, 'FIVE_MINUTES', cyclingReport(endMs, total.distanceMeters), sampledAt, 40);
    }
    const index = (run.events?.length ?? 0) - 1, event = run.events?.at(-1);
    if (event && now - (event.confirmedAt ?? event.timestamp) <= 15000) {
      const type = event.state === 'AUTO_STOP' ? 'AUTO_STOP_CONFIRMED' : event.state === 'BREAK' ? 'BREAK'
        : event.source === 'sensor' ? 'AUTO_RESUME_CONFIRMED' : 'RESUME';
      const message = event.state === 'AUTO_STOP' ? '走行タイマーを一時停止しました。' : event.state === 'BREAK' ? '休憩します。'
        : event.source === 'sensor' ? '走行再開を検知しました。走行タイマーを再開します。' : '走行タイマーを再開します。';
      add(`event:${index}:${event.timestamp}`, type, message, event.confirmedAt ?? event.timestamp, 100, index);
    }
  }
  return { runId, activity: 'cycling', cyclingVoiceEnabled: run.cyclingSettings.voice, ended: !!run.endedAt, cyclingEnd: !!run.endedAt,
    state, paused: state !== 'RUNNING' || !!run.endedAt, cancelCandidate: true,
    latestEventIndex: (run.events?.length ?? 0) - 1, notices,
    clock: { enabled: false, minutes: 10, startedAt: Date.parse(run.startedAt) },
    recovery: { data, message: `保留していた走行情報です。${cyclingReport(time.activeRunningTime, effective.distanceMeters)}` } };
}
