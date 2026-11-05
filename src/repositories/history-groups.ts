import Storage from './storage';
import { database } from './database';
import { RunRepository } from './run-repository';
import { HISTORY_GROUP_KEY, encodeHistoryGroups, parseHistoryGroups, summarizeGroup, type HistoryGroup, type GroupMember } from '../domain/history-groups';
import type { LocationPoint } from '../types/run';
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>) { const p = queue.then(fn,fn); queue = p.then(()=>undefined,()=>undefined); return p; }
export const HistoryGroupsRepository = {
  async get() { return parseHistoryGroups(await Storage.getItem(HISTORY_GROUP_KEY)); },
  async member(id: string): Promise<GroupMember> {
    const source = RunRepository.pagedSource(id), summary = await source.summary();
    if (summary.error || summary.trashedAt) throw Error('元RUNを確認できません。元履歴は変更しません');
    let first: LocationPoint | undefined, last: LocationPoint | undefined;
    if (summary.pointCount) {
      first = ((await source.read('gps',0)).items as LocationPoint[]).find(p => p.timestamp >= Date.parse(summary.startedAt));
      last = ((await source.read('gps',Math.max(0,summary.pointCount-128))).items as LocationPoint[]).filter(p => p.timestamp <= Date.parse(summary.endedAt)).at(-1);
    }
    return { summary, first, last };
  },
  async preview(ids: string[], continuous = false) { return summarizeGroup(await Promise.all(ids.map(id => this.member(id))),continuous); },
  create(ids: string[], continuous = false) { return serialized(async () => {
    const preview = await HistoryGroupsRepository.preview(ids,continuous);
    const g: HistoryGroup = { id: `group-${Date.now()}-${Math.random().toString(36).slice(2)}`, memberIds: preview.memberIds, createdAt: new Date().toISOString(), continuous };
    await (await database()).atomic(async store=>{
      const groups=parseHistoryGroups(await store.readSetting(HISTORY_GROUP_KEY));
      await store.writeSetting(HISTORY_GROUP_KEY,encodeHistoryGroups([...groups,g]));
    }); return g;
  }); },
  remove(id: string) { return serialized(async () => {
    await (await database()).atomic(async store=>{
      const groups=parseHistoryGroups(await store.readSetting(HISTORY_GROUP_KEY)).filter(g=>g.id!==id);
      await store.writeSetting(HISTORY_GROUP_KEY,groups.length?encodeHistoryGroups(groups):null);
    });
  }); },
};
