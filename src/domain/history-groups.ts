import type { LocationPoint } from '../types/run';
import type { RunSummary } from './pages';
import { distanceBetween } from '../utils/distance';
export const HISTORY_GROUP_KEY = '@runjourney/history-groups/v1';
export type HistoryGroup = { id: string; memberIds: string[]; createdAt: string; continuous?: boolean };
export type GroupMember = { summary: RunSummary; first?: LocationPoint; last?: LocationPoint };
export function parseHistoryGroups(text: string | null): HistoryGroup[] {
  if (!text) return [];
  const value = JSON.parse(text) as { version: number; groups: HistoryGroup[] };
  if (value?.version !== 1 || !Array.isArray(value.groups) || value.groups.length > 500) throw Error('グループ情報の形式が不正です');
  const used = new Set<string>(), ids = new Set<string>();
  for (const g of value.groups) {
    if (!g || typeof g.id !== 'string' || g.id.length > 256 || !g.id || ids.has(g.id) || !Number.isFinite(Date.parse(g.createdAt)) ||
      !Array.isArray(g.memberIds) || g.memberIds.length < 2 || g.memberIds.length > 20) throw Error('グループ構造が不正です');
    ids.add(g.id);
    for (const id of g.memberIds) {
      if (typeof id !== 'string' || !id || id.length > 256 || used.has(id)) throw Error('RUNのグループ所属が重複しています');
      used.add(id);
    }
  }
  return value.groups;
}
export function encodeHistoryGroups(groups: HistoryGroup[]) {
  const text = JSON.stringify({ version: 1, groups }); parseHistoryGroups(text); return text;
}
export function mergeHistoryGroups(current: string | null, incoming: string) {
  const a = parseHistoryGroups(current), b = parseHistoryGroups(incoming);
  for (const g of b) {
    const existing = a.find(v => v.id === g.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(g)) throw Error('復元グループIDの競合です');
    if (!existing) a.push(g);
  }
  return encodeHistoryGroups(a); // Reject overlapping membership atomically.
}
function usable(p: LocationPoint | undefined) {
  return p && [p.latitude, p.longitude, p.timestamp, p.accuracy].every(Number.isFinite) &&
    Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && p.accuracy! >= 0 && p.accuracy! <= 20;
}
export function summarizeGroup(members: GroupMember[], continuous = false) {
  if (members.length < 2 || members.length > 20 || new Set(members.map(m => m.summary.id)).size !== members.length) throw Error('異なるRUNを2〜20件選択してください');
  const ordered = [...members].sort((a,b) => Date.parse(a.summary.startedAt) - Date.parse(b.summary.startedAt));
  if (ordered.some(m => m.summary.error || m.summary.trashedAt || !Number.isFinite(Date.parse(m.summary.startedAt)) || !Number.isFinite(Date.parse(m.summary.endedAt)))) throw Error('通常履歴の完了済みRUNだけを選択してください');
  const gaps = ordered.slice(1).map((next, i) => {
    const previous = ordered[i], end = Date.parse(previous.summary.endedAt), start = Date.parse(next.summary.startedAt), gapMs = start - end;
    if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > 300000) throw Error('すべての隣接RUNはEND→STARTが0〜300秒以内である必要があります');
    const a = previous.last, b = next.first;
    const unknown = (reason: string) => ({ gapMs, estimatedDistanceMeters: null, estimatedRunningMs: null, reason });
    if (!usable(a) || !usable(b)) return unknown('GPS_MISSING_OR_INACCURATE');
    if (Math.abs(a!.timestamp - end) > 15000 || Math.abs(b!.timestamp - start) > 15000) return unknown('GPS_NOT_NEAR_BOUNDARY');
    const dt = b!.timestamp - a!.timestamp;
    if (a!.timestamp > end || b!.timestamp < start) return unknown('GPS_DOES_NOT_BRACKET_GAP');
    const distance = distanceBetween(a!, b!) * gapMs / dt;
    if (dt <= 0) return unknown('GPS_TIME_REVERSED_OR_ZERO');
    if (!Number.isFinite(distance) || distance / (dt / 1000) > 12.5) return unknown('IMPLAUSIBLE_SPEED');
    if (gapMs === 0) return unknown('ZERO_GAP_UNRECORDED_PATH_UNKNOWN');
    // Do not interpret uncertain displacement as confirmed movement. Speed alone
    // is not proof; both endpoints must corroborate it and exceed uncertainty.
    const movement = continuous && distance / (gapMs/1000) >= .5 && distance > Math.max(3, a!.accuracy! + b!.accuracy!) &&
      [a!.speed, b!.speed].every(v => typeof v === 'number' && v >= .5 && v <= 12.5);
    return { gapMs, estimatedDistanceMeters: distance, estimatedRunningMs: movement ? gapMs : null,
      reason: movement ? 'ENDPOINT_CORROBORATED_STRAIGHT_LINE_ESTIMATE' : 'DISTANCE_ONLY_MOVEMENT_UNCONFIRMED' };
  });
  const recordedDistanceMeters = ordered.reduce((s,m) => s + m.summary.distanceMeters, 0);
  const recordedRunningMs = ordered.reduce((s,m) => s + m.summary.activeRunningTime, 0);
  const estimatedDistanceMeters = gaps.every(g => g.estimatedDistanceMeters !== null) ? gaps.reduce((s,g) => s + g.estimatedDistanceMeters!, 0) : null;
  const estimatedRunningMs = gaps.every(g => g.estimatedRunningMs !== null) ? gaps.reduce((s,g) => s + g.estimatedRunningMs!, 0) : null;
  return { memberIds: ordered.map(m => m.summary.id), startedAt: ordered[0].summary.startedAt, endedAt: ordered.at(-1)!.summary.endedAt,
    recordedDistanceMeters, recordedRunningMs, gaps, estimatedDistanceMeters, estimatedRunningMs,
    knownEstimatedDistanceMeters: gaps.reduce((s,g)=>s+(g.estimatedDistanceMeters??0),0),
    unknownDistanceGaps: gaps.filter(g=>g.estimatedDistanceMeters===null).length,
    displayDistanceMeters: estimatedDistanceMeters === null ? null : recordedDistanceMeters + estimatedDistanceMeters,
    displayRunningMs: estimatedRunningMs === null ? null : recordedRunningMs + estimatedRunningMs,
    wallClockMs: Date.parse(ordered.at(-1)!.summary.endedAt) - Date.parse(ordered[0].summary.startedAt),
    rankingDistanceMeters: recordedDistanceMeters };
}
