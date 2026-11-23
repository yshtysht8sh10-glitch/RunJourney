import type { RunHistoryItem } from '../types/run';
import type { summarizeGroup } from './history-groups';
export type GroupView = { id: string; value: ReturnType<typeof summarizeGroup> };
// Page offsets always count original RUNs. Resolve display membership independently.
export function historyRows(runs: RunHistoryItem[], groups: GroupView[]) {
  const loaded = new Set(runs.map(r => r.id));
  const visible = groups.filter(g => g.value.memberIds.some(id => loaded.has(id)));
  const hidden = new Set(visible.flatMap(g => g.value.memberIds));
  return [...runs.filter(r => !hidden.has(r.id)), ...visible.map(g => ({
    id: 'display:' + g.id, startedAt: g.value.startedAt, groupValue: g.value,
  }))].sort((a,b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
}
