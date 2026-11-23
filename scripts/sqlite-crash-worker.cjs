const { open } = require('./sqlite-pc-runtime.cjs');
async function main() {
  const [filename,phase] = process.argv.slice(2), db = open(filename);
  const draft = {id:'crash',startedAt:new Date(0).toISOString(),createdAt:'',updatedAt:'',points:[],events:[],distanceMeters:0};
  if (phase==='start') await db.store.saveDraft(draft);
  else if (phase==='running') await db.store.saveDraft({...await db.store.getDraft(),points:[{latitude:35,longitude:139,timestamp:1000}]});
  else if (phase==='stop') {
    const frozen = {...await db.store.getDraft(),endedAt:new Date(2000).toISOString()}; await db.store.saveDraft(frozen);
    db.inject(sql => { if(sql.startsWith('DELETE FROM active_run')) process.kill(process.pid,'SIGKILL'); });
    await db.store.complete(frozen);
  }
  process.kill(process.pid,'SIGKILL');
}
main().catch(e=>{console.error(e);process.exit(92)});
