import { iteratePages, type PagedRunSource } from './pages';
import type { LocationPoint } from '@/types/run';
export type RoutePreview = { points: [number,number,boolean][]; bounds: [number,number,number,number]; read: number; omitted: number; valid: number };
/** Bounded drawing samples, streamed from read-only pages. Never edits raw GPS. */
export async function routePreview(source:PagedRunSource,cancelled:()=>boolean=()=>false):Promise<RoutePreview> {
  if(cancelled())throw Error('MAP_CANCELLED');
  const summary=await source.summary();
  if(cancelled())throw Error('MAP_CANCELLED');
  if(summary.trashedAt!=null)throw Error('MAP_RECORD_UNAVAILABLE');
  const stride=Math.max(1,Math.ceil(summary.pointCount/512));
  const points:RoutePreview['points']=[];
  let previous:LocationPoint|undefined, pendingBreak=true, read=0, omitted=0, valid=0;
  let tail:[number,number,boolean]|undefined;
  const bounds:RoutePreview['bounds']=[Infinity,Infinity,-Infinity,-Infinity];
  for await(const page of iteratePages(source,'gps')) {
    if(cancelled())throw Error('MAP_CANCELLED');
    for(const item of page.items) {
      const p=item as LocationPoint;
      const index=read++;
      if(!p||!Number.isFinite(p.timestamp)||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>85.05112878||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180){previous=undefined;pendingBreak=true;omitted++;continue;}
      if(previous&&(p.timestamp<=previous.timestamp||p.timestamp-previous.timestamp>60000||Math.abs(p.longitude-previous.longitude)>180))pendingBreak=true;
      const lat=p.latitude*Math.PI/180;
      tail=[(p.longitude+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2,pendingBreak];
      bounds[0]=Math.min(bounds[0],tail[0]);bounds[1]=Math.min(bounds[1],tail[1]);bounds[2]=Math.max(bounds[2],tail[0]);bounds[3]=Math.max(bounds[3],tail[1]);
      valid++;
      if(index%stride===0||points.length===0){points.push(tail);pendingBreak=false;tail=undefined;}
      previous=p;
    }
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    if(cancelled())throw Error('MAP_CANCELLED');
  }
  if(tail)points.push(tail);
  return {points,bounds:valid?bounds:[0,0,1,1],read,omitted,valid};
}
