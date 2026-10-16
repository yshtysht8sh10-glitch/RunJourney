const {open} = require('./sqlite-pc-runtime.cjs');
const {SqliteStore,canonical} = require('../src/repositories/sqlite-store.ts');
const {encodeBackup,decodeBackup,restoreBackup} = require('../src/repositories/sqlite-backup.ts');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const digest = async text => createHash('sha256').update(text).digest('hex');
const run = id => ({id,startedAt:new Date(0).toISOString(),endedAt:new Date(10000).toISOString(),createdAt:'',updatedAt:'',distanceMeters:0,points:[],events:[]});
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(),'runjourney-sqlite-test-'));
async function using(fn) {const root=temporary(),db=open(path.join(root,'db.sqlite'));try{await fn(db,root)}finally{db.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true});}}
for (const count of [1,100,1000,10000]) test(`${count} runs: append and paginated reads never load all history`,()=>using(async db=>{
  await db.store.importRuns(Array.from({length:count},(_,i)=>run('r'+i)));
  db.statements.length=0;
  await db.store.saveDraft({...run('new'),endedAt:undefined});await db.store.complete(run('new'));
  const page=await db.store.summaries(100,0);
  assert.equal(page.length,Math.min(100,count+1));
  assert.ok(!db.statements.some(sql=>/SELECT id FROM runs WHERE status='completed'/.test(sql)));
  assert.equal(db.native.prepare('SELECT count(*) AS n FROM runs').get().n,count+1);
}));
test('50,000 GPS points + huge metadata: restart, immutable raw values, bounded SQL rows',()=>using(async(db,root)=>{
  const large={...run('large'),points:Array.from({length:50000},(_,i)=>({latitude:35,longitude:139,timestamp:i*1000,accuracy:5,altitude:0,speed:0})),extension:'😀'.repeat(600000)};
  await db.store.importRuns([large]);const restored=await db.store.getRun('large');assert.equal(canonical(restored),canonical(large));
  for(const table of ['gps_points','run_events','run_metadata','run_operations','run_diagnostics']) assert.ok(db.native.prepare(`SELECT coalesce(max(length(CAST(payload AS BLOB))),0) AS n FROM ${table}`).get().n<=32768);
  await assert.rejects(db.store.update('large',r=>({...r,points:[{...r.points[0],latitude:36},...r.points.slice(1)]})),/immutable|Raw GPS/);
  assert.throws(()=>db.native.prepare('UPDATE gps_points SET payload=? WHERE run_id=? AND seq=0').run('{}','large'),/immutable/);
  assert.equal(canonical(await db.store.getRun('large')),canonical(large));
  const reopen=open(path.join(root,'db.sqlite'));assert.equal((await reopen.store.getRun('large')).points.length,50000);reopen.close();
}));
test('START, RUN, STOP mid-transaction process kills preserve committed draft and retry once',async()=>{
  const root=temporary(),filename=path.join(root,'crash.sqlite');
  try {
    for(const phase of ['start','running','stop']) {
      const child=spawnSync(process.execPath,[path.join(__dirname,'sqlite-crash-worker.cjs'),filename,phase],{encoding:'utf8'});assert.notEqual(child.status,0,child.stderr);
      const db=open(filename);const draft=await db.store.getDraft();assert.equal(draft.id,'crash');
      if(phase!=='start')assert.equal(draft.points.length,1);
      if(phase==='stop') {
        assert.equal(draft.endedAt,new Date(2000).toISOString());assert.equal((await db.store.list(true)).length,0);
        await db.store.complete(draft);await db.store.complete({...draft,endedAt:new Date(9000).toISOString()});
        assert.equal((await db.store.list(true)).length,1);assert.equal((await db.store.getRun('crash')).endedAt,draft.endedAt);assert.equal(await db.store.getDraft(),null);
      }
      assert.equal(db.native.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
    }
  }finally{fs.rmSync(root,{recursive:true});}
});
test('real SQLITE_FULL and readonly failures rollback without losing existing runs',()=>using(async db=>{
  await db.store.importRuns([run('safe')]);const before=canonical(await db.store.snapshot());
  const pages=db.native.prepare('PRAGMA page_count').get().page_count;db.native.exec(`PRAGMA max_page_count=${pages}`);
  await assert.rejects(db.store.importRuns([{...run('full'),extension:'x'.repeat(3*1024*1024)}]),/full/);
  assert.equal(canonical(await db.store.snapshot()),before);
  db.native.exec('PRAGMA query_only=ON');await assert.rejects(db.store.saveDraft({...run('readonly'),endedAt:undefined}),/readonly/);
  db.native.exec('PRAGMA query_only=OFF');assert.equal(canonical(await db.store.snapshot()),before);
}));
test('schema migration failure rolls back DDL/version; future update refused unchanged',()=>using(async db=>{
  await db.store.importRuns([run('safe')]);const before=canonical(await db.store.snapshot());
  db.native.exec('PRAGMA user_version=99');await assert.rejects(new SqliteStore(db.store.db).atomic(async()=>{}),/スキーマ/);
  assert.equal(db.native.prepare('PRAGMA user_version').get().user_version,99);
  db.native.exec('PRAGMA user_version=1');assert.equal(canonical(await db.store.snapshot()),before);
  const broken=open(':memory:');let failed=false;
  broken.inject(sql=>{if(!failed&&sql.includes('PRAGMA user_version=1')){failed=true;throw Error('migration failed')}});
  await assert.rejects(broken.store.atomic(async()=>{}),/migration failed/);
  assert.equal(broken.native.prepare('PRAGMA user_version').get().user_version,0);
  assert.equal(broken.native.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='runs'").get().n,0);
  broken.inject(undefined);await broken.store.atomic(async()=>{});broken.close();
}));
test('backup uses committed WAL data; failed backup/restore and repeated restore preserve records',()=>using(async(db,root)=>{
  await db.store.importRuns([run('old')]);await db.store.saveDraft({...run('draft'),endedAt:undefined,points:[{latitude:35,longitude:139,timestamp:0}]});
  await db.store.setSetting('@runjourney/run-features/v1','{"autoStop":true,"break":false}');
  assert.ok(fs.existsSync(path.join(root,'db.sqlite-wal')));
  const before=canonical(await db.store.snapshot()),backup=await encodeBackup(db.store,digest),decoded=await decodeBackup(backup,digest);
  await assert.rejects(encodeBackup(db.store,async()=>{throw Error('backup failed')}),/backup failed/);assert.equal(canonical(await db.store.snapshot()),before);
  await assert.rejects(restoreBackup(db.store,backup.replace('"old"','"tampered"'),digest),/SHA-256/);
  const fresh=open(path.join(root,'fresh.sqlite'));let failed=false;
  fresh.inject(sql=>{if(!failed&&sql.startsWith('INSERT INTO gps_points')){failed=true;throw Error('restore failed')}});
  await assert.rejects(restoreBackup(fresh.store,backup,digest),/restore failed/);assert.equal((await fresh.store.snapshot()).runs.length,0);
  fresh.inject(undefined);await restoreBackup(fresh.store,backup,digest);assert.equal(canonical(await fresh.store.snapshot()),before);
  assert.equal((await restoreBackup(fresh.store,backup,digest)).added,0);assert.equal(canonical(await fresh.store.snapshot()),before);
  const conflict=open(':memory:');await conflict.store.importRuns([{...run('old'),distanceMeters:7}]);
  await conflict.store.restore({...decoded.snapshot,draft:null});assert.equal((await conflict.store.getRun('old')).distanceMeters,7);
  conflict.close();fresh.close();
}));
test('one corrupted record cannot block summaries or another run; failure is never empty history',()=>using(async db=>{
  await db.store.importRuns([run('bad'),run('good')]);db.native.prepare('UPDATE run_metadata SET payload=? WHERE run_id=?').run('{broken','bad');
  await assert.rejects(db.store.getRun('bad'));assert.equal((await db.store.getRun('good')).id,'good');assert.equal((await db.store.summaries()).length,2);
  await db.store.importRuns([run('new')]);assert.equal((await db.store.getRun('new')).id,'new');
}));
test('Diagnostics cap/deletion leave GPS/events/operations/results intact',()=>using(async db=>{
  const core={...run('d'),points:[{latitude:35,longitude:139,timestamp:0}],events:[{timestamp:1000,state:'BREAK',source:'user'}],stopOverrides:{'0:1000:BREAK':{included:true,updatedAt:''}}};
  await db.store.saveDraft({...core,endedAt:undefined,diagnostics:{entries:[],counts:{},processed:0,extension:'x'.repeat(5*1024*1024)}});
  await db.store.complete({...core,diagnostics:{entries:[],counts:{HOLD:1},processed:1}});
  const before=await db.store.getRun('d');await db.store.pruneDiagnostics(new Date(Date.now()-30*86400000).toISOString());
  const after=await db.store.getRun('d');const {diagnostics:_a,...a}=before,{diagnostics:_b,...b}=after;assert.equal(canonical(a),canonical(b));assert.equal(after.diagnostics,undefined);
}));
test('telemetry write failure is reported but cannot roll back GPS/STOP core data',()=>using(async db=>{
  db.inject(sql=>{if(sql.startsWith('INSERT INTO run_diagnostics'))throw Error('telemetry disk failure')});
  const draft={...run('telemetry'),endedAt:undefined,points:[{latitude:35,longitude:139,timestamp:0}],diagnostics:{entries:[],counts:{},processed:0}};
  await db.store.saveDraft(draft);
  assert.equal((await db.store.getDraft()).points.length,1);assert.match(db.store.diagnosticWarning,/Diagnostics保存失敗/);
  await db.store.complete({...draft,endedAt:new Date(10000).toISOString()});
  assert.equal((await db.store.getRun('telemetry')).points.length,1);assert.equal(await db.store.getDraft(),null);
}));
test('updated-app initialization failure leaves previous SQLite data readable',()=>using(async(db,root)=>{
  await db.store.importRuns([run('before-update')]);const before=canonical(await db.store.snapshot());
  const updated=open(path.join(root,'db.sqlite'));
  updated.inject(sql=>{if(sql==='PRAGMA quick_check')throw Error('updated-app startup failed')});
  await assert.rejects(updated.store.atomic(async()=>{}),/startup failed/);updated.close();
  const reopen=open(path.join(root,'db.sqlite'));assert.equal(canonical(await reopen.store.snapshot()),before);reopen.close();
}));
