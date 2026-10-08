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

// Round only at presentation. Japanese kana avoids engine-dependent parsing of
// decimal punctuation; retaining both digits also makes 1.00 explicit.
export function lapDistanceSpeech(meters: number): string | null {
  if (!Number.isFinite(meters) || meters < 0) return null;
  const units = Math.round(meters / 10);
  if (!Number.isSafeInteger(units)) return null;
  const decimal = (units / 100).toFixed(2);
  const [whole, fraction] = decimal.split('.');
  const digits = ['れい', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
  return `${whole === '0' ? 'れい' : whole}てん${fraction.split('').map(digit => digits[Number(digit)]).join('')}キロメートル`;
}

export function formatAnnouncement(elapsedMs: number, totalMeters: number, lap: PaceAnalysis | null, items: VoiceItems): string {
  const parts: string[] = [];
  if (items.elapsed && Number.isFinite(elapsedMs) && elapsedMs >= 0) parts.push(`${Math.floor(elapsedMs / 60_000)}分です`);
  if (items.totalDistance && Number.isFinite(totalMeters) && totalMeters >= 0) parts.push(`総走行距離${lapDistanceSpeech(totalMeters)}`);
  if (lap && Number.isFinite(lap.distanceMeters) && lap.distanceMeters >= 30 && Number.isFinite(lap.durationMs) && lap.durationMs > 0) {
    const distanceSpeech = lapDistanceSpeech(lap.distanceMeters);
    if (items.lapDistance && distanceSpeech) parts.push(`直近${Math.round(lap.durationMs / 60_000)}分間で${distanceSpeech}`);
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
