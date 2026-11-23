import { routePreview } from '@/domain/route-preview';
import { sourceFromRun } from '@/domain/pages';
import type { RunRecord } from '@/types/run';
const run=(n:number):RunRecord=>({id:'map',startedAt:new Date(0).toISOString(),endedAt:new Date(n*5000).toISOString(),createdAt:'',updatedAt:'',distanceMeters:0,
  points:Array.from({length:n},(_,i)=>({timestamp:i*5000,latitude:35+i*.000001,longitude:139,accuracy:5}))});
test('large route streams bounded pages and samples without modifying any raw fields',async()=>{
  const record=run(10000),before=JSON.stringify(record),source=sourceFromRun(record),read=jest.spyOn(source,'read');
  const preview=await routePreview(source);
  expect(preview.points.length).toBeLessThanOrEqual(514);expect(preview.read).toBe(10000);expect(preview.omitted).toBe(0);
  expect(read.mock.calls.every(([kind])=>kind==='gps')).toBe(true);expect(read.mock.calls.length).toBeGreaterThan(1);
  expect(JSON.stringify(record)).toBe(before);
});
test('invalid/polar points, clock reversal, gaps and antimeridian crossings split the drawing',async()=>{
  const record=run(8);
  record.points[1].latitude=999;record.points[2].latitude=89;
  record.points[4].timestamp=record.points[3].timestamp-1;
  record.points[5].timestamp=record.points[4].timestamp+61000;
  record.points[6].longitude=-179;record.points[7].longitude=179;
  const before=JSON.stringify(record),preview=await routePreview(sourceFromRun(record));
  expect(preview.omitted).toBe(2);expect(preview.points.filter(p=>p[2]).length).toBeGreaterThanOrEqual(5);
  expect(JSON.stringify(record)).toBe(before);
});
test('trashed record and cancellation stop without reading additional GPS',async()=>{
  const record=run(10),source=sourceFromRun({...record,trashedAt:1}),read=jest.spyOn(source,'read');
  await expect(routePreview(source)).rejects.toThrow('MAP_RECORD_UNAVAILABLE');expect(read).not.toHaveBeenCalled();
  await expect(routePreview(sourceFromRun(record),()=>true)).rejects.toThrow('MAP_CANCELLED');
});
