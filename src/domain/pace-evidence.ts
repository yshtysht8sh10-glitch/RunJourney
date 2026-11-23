import type { ActiveRun } from '@/types/run';
import { effectiveEdges, effectivePoints, timeModel } from '@/utils/run-model';
import { distanceBetween, usableDistancePoint, MAX_RUNNING_SPEED_METERS_PER_SECOND } from '@/utils/distance';
import { usableObservation } from '@/utils/movement-inference';

// Speech freshness, not a GPS admission/filter or Auto Stop threshold.
export const PACE_STALE_GPS_MS = 60000;
export type PaceEvidenceValue = { meters:number; savings:number; activeMs:number; asOfAt:number; numeric:boolean; stale:boolean; warnings:string[] };
export function paceEvidence(run:ActiveRun,now:number,target:number) {
  const started=Date.parse(run.startedAt);
  // Keep rejected edges separated. Removing a future fix could fabricate a new
  // edge between its neighbours, so mask it for the existing distance filter.
  const causal={...run,endedAt:undefined,points:run.points.map(p=>p.timestamp>now?{...p,accuracy:Infinity}:p)};
  const received=run.points.filter(p=>p.timestamp<=now);
  const events=run.recovery?.events??run.events??[];
  const ordered=received.every((p,i)=>Number.isFinite(p.timestamp)&&(!i||p.timestamp>received[i-1].timestamp));
  function validClockAt(at:number) {
    const end=received.findIndex(p=>p.timestamp>=at),prefix=end<0?received:received.slice(0,end+1);
    const eventPrefix=events.filter(e=>!Number.isFinite(e.timestamp)||e.timestamp<=at);
    return prefix.every((p,i)=>Number.isFinite(p.timestamp)&&(!i||p.timestamp>prefix[i-1].timestamp))
      && eventPrefix.every((e,i)=>Number.isFinite(e.timestamp)&&e.timestamp>=started&&(!i||e.timestamp>=eventPrefix[i-1].timestamp));
  }
  const activeAt=(at:number)=>timeModel(causal,at).activeRunningTime;
  const edges=effectiveEdges(causal,now), effective=effectivePoints(causal);
  const pairs: {start:number;end:number}[]=[];
  for(let i=1;i<effective.length;i++) {
    const a=effective[i-1],b=effective[i],dt=(b.timestamp-a.timestamp)/1000;
    if(a.timestamp<started||b.timestamp>now||!Number.isFinite(dt)||dt<=0||!usableDistancePoint(a)||!usableDistancePoint(b))continue;
    if(distanceBetween(a,b)/dt<=MAX_RUNNING_SPEED_METERS_PER_SECOND)pairs.push({start:a.timestamp,end:b.timestamp});
  }
  const evidenceTimes=[...new Set(pairs.flatMap(p=>[p.start,p.end]))].sort((a,b)=>a-b);
  const metersAt=(at:number)=>{
    if(!ordered){const end=causal.points.findIndex(p=>p.timestamp>=at&&p.timestamp<=now);return effectiveEdges({...causal,points:end<0?causal.points:causal.points.slice(0,end+1)},at).reduce((sum,e)=>sum+e.distanceMeters,0);}
    const active=activeAt(at);return edges.reduce((sum,e)=>sum+e.distanceMeters*Math.max(0,Math.min(active,e.endMs)-e.startMs)/(e.endMs-e.startMs),0);
  };
  function warnings(from:number,at:number):string[] {
    const flags=new Set<string>();
    const first=received[0];
    if(!first)return ['NO_GPS'];
    if(first.timestamp>from+10000&&activeAt(Math.min(first.timestamp,at))>activeAt(from))flags.add('START_GPS_GAP');
    if(!received.some(p=>p.timestamp>=at))flags.add('BOUNDARY_NOT_BRACKETED');
    if(!usableObservation(first)&&first.timestamp>=from&&first.timestamp<=at)flags.add('GPS_QUALITY');
    if(from===started&&flags.size)return [...flags];
    for(let i=1;i<received.length;i++) {
      const a=received[i-1],b=received[i];
      if(a.timestamp>=at)break;
      if(b.timestamp<from||activeAt(Math.min(b.timestamp,at))<=activeAt(Math.max(a.timestamp,from)))continue;
      if(!usableObservation(a)||!usableObservation(b))flags.add('GPS_QUALITY');
      if(b.timestamp-a.timestamp>10000)flags.add('GPS_GAP');
      if(distanceBetween(a,b)/((b.timestamp-a.timestamp)/1000)>MAX_RUNNING_SPEED_METERS_PER_SECOND)flags.add('GPS_SPEED_SPIKE');
      if(from===started&&flags.size)break;
    }
    if(!validClockAt(at))flags.add('CLOCK_OR_STATE_INVALID');
    return [...flags];
  }
  const cache=new Map<number,PaceEvidenceValue>();
  function boundary(at:number):PaceEvidenceValue {
    if(cache.has(at))return cache.get(at)!;
    const before=evidenceTimes.findLast(t=>t<=at),after=evidenceTimes.find(t=>t>=at);
    const streamStale=evidenceTimes.length>0&&now-evidenceTimes[evidenceTimes.length-1]>PACE_STALE_GPS_MS;
    const stale=before!==undefined&&(streamStale||at>before&&(at-before>PACE_STALE_GPS_MS||after!==undefined&&after-before>PACE_STALE_GPS_MS));
    const asOfAt=stale?before!:at,activeMs=activeAt(asOfAt),meters=metersAt(asOfAt),savings=target*meters/1000-activeMs/1000;
    const numeric=validClockAt(at)&&before!==undefined&&Number.isFinite(meters)&&meters>=0&&Number.isFinite(savings)&&Number.isFinite(activeMs)&&activeMs>0;
    const value={meters,savings,activeMs,asOfAt,numeric,stale,warnings:warnings(started,asOfAt)};
    cache.set(at,value);return value;
  }
  function interval(from:number,at:number) {
    const activeMs=activeAt(at)-activeAt(from),meters=metersAt(at)-metersAt(from);
    const basis=pairs.some(p=>p.end>from&&p.start<at&&(p.start>=from||p.end<=at||p.end-p.start<=PACE_STALE_GPS_MS));
    return {activeMs,meters,savings:target*meters/1000-activeMs/1000,
      numeric:validClockAt(at)&&basis&&activeMs>0&&Number.isFinite(meters)&&meters>=0&&!boundary(at).stale,
      warnings:warnings(from,at)};
  }
  return {validClockAt,activeAt,boundary,interval};
}
