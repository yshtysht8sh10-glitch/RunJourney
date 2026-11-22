import { historyRows } from '@/domain/history-list';
import { summarizeGroup } from '@/domain/history-groups';
import type { RunHistoryItem } from '@/types/run';
const row=(id:string,t:number)=>({id,startedAt:new Date(t).toISOString(),endedAt:new Date(t+1).toISOString(),distanceMeters:100,activeRunningTime:1000,kmPerHour:360}) as RunHistoryItem;
const group={id:'g',value:{memberIds:['old','new'],startedAt:new Date(0).toISOString()} as ReturnType<typeof summarizeGroup>};
test.each([[row('new',2)],[row('new',2),row('old',0)]].map(rows=>[rows]))('partial and complete page show one group with stable original start',rows=>{
 const r=historyRows([row('later',10),...rows],[group]);expect(r.map(x=>x.id)).toEqual(['later','display:g']);expect(r[1].startedAt).toBe(group.value.startedAt);
});
test('unloaded group stays absent; ungroup restores loaded members in order without mutation',()=>{
 const rows=[row('later',10),row('new',2),row('old',0)],before=JSON.stringify(rows);
 expect(historyRows([rows[0]],[group])).toEqual([rows[0]]);
 expect(historyRows(rows,[]).map(r=>r.id)).toEqual(['later','new','old']);expect(JSON.stringify(rows)).toBe(before);
});

