import { LatestCheckpoint } from '@/repositories/latest-checkpoint';
test('slow checkpoint coalesces cumulative snapshots without blocking producers, barrier persists newest', async () => {
  const writes: number[][] = []; let release!: () => void;
  const queue = new LatestCheckpoint<number[]>(async v => { writes.push(v); if(writes.length===1) await new Promise<void>(r=>{release=r;}); },()=>{});
  queue.schedule([1]); await Promise.resolve();
  for(let i=2;i<=100;i++) queue.schedule(Array.from({length:i},(_,n)=>n+1));
  expect(writes).toEqual([[1]]); release(); await queue.flush();
  expect(writes).toHaveLength(2); expect(writes[1]).toHaveLength(100);
});
test('failure retains latest snapshot and barrier fails until retry succeeds',async()=>{
  let fail=true; const writes:number[]=[];
  const q=new LatestCheckpoint<number>(async v=>{if(fail)throw Error('disk full');writes.push(v);},()=>{});
  q.schedule(1); await expect(q.flush()).rejects.toThrow('disk full');
  fail=false; q.schedule(2); await q.flush();expect(writes).toEqual([2]);
});
