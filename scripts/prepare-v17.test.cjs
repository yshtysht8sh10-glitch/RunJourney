const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {open}=require('./sqlite-pc-runtime.cjs');
const {encodeBackup}=require('../src/repositories/sqlite-backup.ts');
const {hashText}=require('../src/domain/pages.ts');
const {syntheticRun}=require('../src/test/long-run.ts');
const {prepare}=require('./prepare-v17.cjs');
test('v17 backup conversion validates SHA, excludes draft/trash/settings, preserves source and refuses overwrite',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'runjourney-convert-')), db=open(':memory:');
  try{
    const run=syntheticRun(.5,5000,'synthetic-conversion'),trash={...syntheticRun(.1,5000,'synthetic-trash'),trashedAt:Date.now()};
    await db.store.complete(run);await db.store.complete(trash);await db.store.saveDraft({...syntheticRun(.1,5000,'synthetic-draft'),endedAt:undefined});await db.store.setSetting('@runjourney/private-test','not-for-upload');
    const input=path.join(root,'copy.json'),output=path.join(root,'result.ndjson');
    const text='\uFEFF'+await encodeBackup(db.store,async x=>hashText(x));await fs.writeFile(input,text);
    const result=await prepare(input,output);assert.equal(result.runs,1);assert.equal(result.points,run.points.length);
    assert.equal(await fs.readFile(input,'utf8'),text);
    const data=await fs.readFile(output,'utf8');assert.ok(!data.includes('not-for-upload'));assert.ok(!data.includes('synthetic-trash'));assert.ok(!data.includes('synthetic-draft'));
    const lines=data.trim().split('\n').map(x=>JSON.parse(x));assert.equal(lines[0].format,'runjourney-paged');assert.equal(lines.at(-1).type,'end-run');
    assert.equal(lines.filter(x=>x.type==='page'&&x.page.kind==='gps').reduce((n,x)=>n+x.page.items.length,0),run.points.length);
    await assert.rejects(prepare(input,output),/EEXIST/);assert.equal(await fs.readFile(output,'utf8'),data);
    await assert.rejects(prepare(input,input));
    const bad=path.join(root,'bad.json');await fs.writeFile(bad,text.replace('"sha256":"','"sha256":"0'));await assert.rejects(prepare(bad,path.join(root,'bad.ndjson')),/SHA-256/);
    await assert.rejects(fs.stat(path.join(root,'bad.ndjson')),/ENOENT/);
  }finally{db.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'runjourney-convert-'));await fs.rm(root,{recursive:true,force:true});}
});
