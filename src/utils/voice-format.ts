import { MARATHON_METERS, PaceAnalysis } from '@/utils/pace-analysis';

export type VoiceItems = {
  elapsed: boolean;
  totalDistance: boolean;
  lapDistance: boolean;
  pace: boolean;
  speed: boolean;
  marathon: boolean;
};

export const DEFAULT_VOICE_ITEMS: VoiceItems = {
  elapsed: true, totalDistance: true, lapDistance: false,
  pace: false, speed: false, marathon: false,
};

const km = (meters: number) => (Math.round(meters / 100) / 10).toFixed(1);

export function formatAnnouncement(elapsedMs: number, totalMeters: number, lap: PaceAnalysis | null, items: VoiceItems): string {
  const parts: string[] = [];
  if (items.elapsed) parts.push(`${Math.floor(elapsedMs / 60_000)}分です`);
  if (items.totalDistance) parts.push(`総走行距離${km(totalMeters)}キロメートル`);
  if (lap && lap.distanceMeters >= 30) {
    if (items.lapDistance) parts.push(`直近${Math.round(lap.durationMs / 60_000)}分間で${km(lap.distanceMeters)}キロメートル`);
    if (items.pace && lap.secondsPerKm && Number.isFinite(lap.secondsPerKm)) {
      const seconds = Math.round(lap.secondsPerKm);
      parts.push(`1キロ${Math.floor(seconds / 60)}分${seconds % 60}秒ペース`);
    }
    if (items.speed && lap.kmPerHour && Number.isFinite(lap.kmPerHour)) parts.push(`時速${lap.kmPerHour.toFixed(1)}キロメートル`);
    const projected = lap.projectedTimeSeconds(MARATHON_METERS);
    if (items.marathon && projected && Number.isFinite(projected)) {
      const minutes = Math.round(projected / 60);
      parts.push(`フルマラソン${Math.floor(minutes / 60)}時間${minutes % 60}分ペースです`);
    }
  }
  return parts.join('。') + (parts.length ? '。' : '');
}
