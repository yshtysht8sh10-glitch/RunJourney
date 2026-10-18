/* PC ONLY. Never opens the old DB in SQLite; reads rescued bytes and writes a NEW output directory. */
const { open } = require('./sqlite-pc-runtime.cjs');
const { canonical } = require('../src/repositories/sqlite-store.ts');
const { encodeBackup, decodeBackup, validateSnapshot } = require('../src/repositories/sqlite-backup.ts');
const { effectiveRun } = require('../src/utils/run-model.ts');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = async text => hash(text);
async function main() {
  const [source, output, oldExport] = process.argv.slice(2).map(p => p && path.resolve(p));
  if (!source || !output || output.startsWith(source + path.sep) || fs.existsSync(output)) throw Error('Specify a NEW output directory outside the immutable source');
  const verify = () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(source,'transfer-validation.json')));
    for (const [name, info] of Object.entries(manifest.files)) {
      const bytes = fs.readFileSync(path.join(source,'session-original',name));
      assert.equal(bytes.length,info.bytes,name); assert.equal(hash(bytes),info.sha256,name);
    }
    return manifest;
  };
  const verified = verify();
  const manifest = JSON.parse(fs.readFileSync(path.join(source,'session-original','manifest.json')));
  const values = {};
  for (const entry of manifest.entries) {
    const bytes = fs.readFileSync(path.join(source,'session-original',entry.file));
    assert.equal(hash(bytes),entry.sha256); values[entry.key] = bytes.toString('utf8');
  }
  const snapshot = { runs: JSON.parse(values['@runjourney/runs/v1']), draft: JSON.parse(values['@runjourney/active-run/v1']),
    settings: Object.fromEntries(Object.entries(values).filter(([key]) => !['@runjourney/runs/v1','@runjourney/active-run/v1'].includes(key))) };
  validateSnapshot(snapshot); assert.equal(snapshot.runs.length,23); assert.ok(snapshot.draft.endedAt);
  fs.mkdirSync(output); const migrated = open(path.join(output,'runjourney.sqlite'));
  await migrated.store.restore(snapshot, hash(fs.readFileSync(path.join(source,'session-original','manifest.json'))));
  const after = await migrated.store.snapshot();
  assert.equal(canonical(after.runs),canonical(snapshot.runs)); assert.equal(canonical(after.draft),canonical(snapshot.draft));
  assert.deepEqual(after.settings,snapshot.settings);
  const report = { source, rule:'23 completed (including trash), ended draft preserved, no inferred values, automatic trash purge protected',
    completed:after.runs.length, draftId:after.draft.id, protectedIds:after.protectedIds, sourceVerified:verified.fileCount,
    runs:after.runs.map((run,i) => {
      const before = snapshot.runs[i]; const effective = effectiveRun(run), oldEffective = effectiveRun(before);
      assert.equal(canonical({distance:effective.distanceMeters,time:effective.activeRunningTime}),canonical({distance:oldEffective.distanceMeters,time:oldEffective.activeRunningTime}));
      return {id:run.id,startedAt:run.startedAt,endedAt:run.endedAt,distanceMeters:run.distanceMeters,activeTime:effective.activeRunningTime,
        gps:run.points.length,events:run.events?.length??0,trash:run.trashedAt??null,sourceSemanticSha256:hash(canonical(before)),sqliteSemanticSha256:hash(canonical(run)),rawGpsValuesEqual:true,eventValuesEqual:true,operationsEqual:true,allFieldsEqual:true};
    }), integrity:migrated.native.prepare('PRAGMA integrity_check').all(), foreignKeys:migrated.native.prepare('PRAGMA foreign_key_check').all() };
  const backup = await encodeBackup(migrated.store,digest); fs.writeFileSync(path.join(output,'sqlite-backup-v2.json'),backup,{flag:'wx'});
  const restored = open(path.join(output,'restored-new-device.sqlite'));
  const decoded = await decodeBackup(backup,digest);
  await restored.store.restore(decoded.snapshot);
  assert.equal(canonical(await restored.store.snapshot()),canonical(after));
  assert.equal((await restored.store.restore(decoded.snapshot)).added,0);
  assert.equal(canonical(await restored.store.snapshot()),canonical(after));
  assert.equal(await migrated.store.purgeTrash(Date.now()+365*86400000),0);
  report.roundTrip = 'all runs/draft/settings/protection equal; repeat restore added 0';
  report.draft = { id:after.draft.id,startedAt:after.draft.startedAt,endedAt:after.draft.endedAt,distanceMeters:after.draft.distanceMeters,
    gps:after.draft.points.length,events:after.draft.events?.length??0,status:'ended-draft-not-auto-completed',
    sourceSemanticSha256:hash(canonical(snapshot.draft)),sqliteSemanticSha256:hash(canonical(after.draft)),allFieldsEqual:true };
  if (oldExport) {
    const legacy = JSON.parse(fs.readFileSync(oldExport)); const runs = legacy.runs;
    assert.equal(runs.length,19);
    report.export19 = runs.map(old => {
      const run = after.runs.find(run => run.id===old.id); assert.ok(run,old.id);
      assert.equal(canonical(run.points),canonical(old.points),old.id+' GPS'); assert.equal(canonical(run.events),canonical(old.events),old.id+' events');
      return {id:old.id,rawGpsEqual:true,eventsEqual:true,wholeRecordEqual:canonical(old)===canonical(run),
        differingFields:[...new Set([...Object.keys(old),...Object.keys(run)])].filter(key=>canonical(old[key])!==canonical(run[key]))};
    });
  }
  verify(); report.sourceUnchanged = true;
  fs.writeFileSync(path.join(output,'migration-verification.json'),JSON.stringify(report,null,2),{flag:'wx'});
  migrated.close(); restored.close();
  const files = Object.fromEntries(fs.readdirSync(output).map(name => { const bytes = fs.readFileSync(path.join(output,name)); return [name,{bytes:bytes.length,sha256:hash(bytes)}]; }));
  fs.writeFileSync(path.join(output,'files.json'),JSON.stringify(files,null,2),{flag:'wx'});
  console.log(JSON.stringify({output,completed:23,draft:1,integrity:report.integrity,roundTrip:report.roundTrip,sourceUnchanged:true},null,2));
}
main().catch(error => { console.error(error); process.exitCode=1; });
