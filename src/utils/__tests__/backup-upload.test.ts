import { backupUploadQueue } from '../../sync/backup-upload';
import { sourceFromRun } from '../../domain/pages';
import { demoRuns } from '../../web/demo';
import type { PublishedRun, PagedRemote } from '../../sync/paged-protocol';
function fixture() {
  const run=demoRuns(Date.parse('2026-10-17T03:00:00Z'))[0], original=JSON.stringify(run), source=sourceFromRun(run);
  const blobs=new Map<string,string>(), runs=new Map<string,PublishedRun>();
  let disk:string|null=null, writes=0, fail=true, opens=0;
  const remote: PagedRemote={ get:async id=>runs.get(id)??null,list:async()=>[...runs.values()],getBlob:async hash=>blobs.get(hash)??null,
    putBlob:async(hash,value)=>{if(fail&&++writes===2)throw Error('network interrupted');blobs.set(hash,value);},publish:async header=>{runs.set(header.id,header);} };
  const persistence={load:async()=>disk,save:async(value:string)=>{disk=value;}};
  return {run,original,remote,persistence,blobs,runs,open:async()=>{opens++;return source;},recover:()=>{fail=false;},disk:()=>disk,opens:()=>opens};
}
test('staged backup pages resume after queue reconstruction, with no raw GPS in durable queue', async()=>{
  const f=fixture(),queue=backupUploadQueue('alice',f.persistence,f.open,f.remote);
  await queue.open();await queue.enqueue(f.run.id);await queue.flush();
  expect(queue.state[0].status).toBe('retrying');expect(f.runs.size).toBe(0);expect(f.disk()).not.toContain('latitude');
  const uploaded=f.blobs.size;f.recover();
  const reopened=backupUploadQueue('alice',f.persistence,f.open,f.remote);await reopened.open();await reopened.flush(Date.now(),true);
  expect(reopened.state).toEqual([]);expect(f.runs.size).toBe(1);expect(f.blobs.size).toBeGreaterThan(uploaded);expect(JSON.stringify(f.run)).toBe(f.original);
  await expect(backupUploadQueue('bob',f.persistence,f.open,f.remote).open()).rejects.toThrow('所有者');
});
test('a temporary staging read error can recover on retry rather than caching rejection forever',async()=>{
  const f=fixture();let first=true;
  const queue=backupUploadQueue('alice',f.persistence,async()=>{if(first){first=false;throw Error('temporary IndexedDB error');}return f.open();},f.remote);
  await expect(queue.enqueue(f.run.id)).rejects.toThrow('temporary');
  await queue.enqueue(f.run.id);expect(queue.state).toHaveLength(1);
});
