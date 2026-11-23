const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'runjourney-private-cli-'));
const exportsFixture = {};
const source=fs.readFileSync(path.join(root,'src/test/gps-private-input.ts'),'utf8');
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exportsFixture);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const cli=(...args)=>spawnSync(process.execPath,[path.join(root,'scripts/gps-private.cjs'),...args],{cwd:root,encoding:'utf8',timeout:60000});
test('CLI rejects repository report paths without writing anything',()=>{
  const destination=path.join(root,'must-not-create-private-report.json');
  const r=cli('synthetic','1',destination);
  assert.equal(r.status,1); assert.match(r.stderr,/PRIVATE_PATH_REQUIRED/); assert.equal(fs.existsSync(destination),false);
});
test('private replay preserves source and outputs aggregates only; existing report is never overwritten',()=>{
  const input=path.join(dir,'input.json'), report=path.join(dir,'report.json');
  fs.writeFileSync(input,JSON.stringify(exportsFixture.privateScenario(2)),{flag:'wx'}); const before=hash(input);
  const r=cli('replay',input,report); assert.equal(r.status,0,r.stderr);
  const value=JSON.parse(fs.readFileSync(report,'utf8'));
  assert.equal(value.mode,'private-replay'); assert.ok(value.inputFixes>100); assert.ok(value.paceSlots>=1);
  assert.equal(hash(input),before); assert.doesNotMatch(fs.readFileSync(report,'utf8'),/latitude|longitude|coords|runId/);
  const reportHash=hash(report), again=cli('replay',input,report);
  assert.equal(again.status,1); assert.equal(hash(report),reportHash); assert.equal(hash(input),before);
});
test('malformed private text and filesystem errors cannot escape through child output',()=>{
  const input=path.join(dir,'bad.json'), report=path.join(dir,'bad-report.json');
  fs.writeFileSync(input,'SECRET_COORDINATE_SENTINEL',{flag:'wx'});
  const r=cli('replay',input,report);assert.equal(r.status,1);
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET_COORDINATE_SENTINEL|bad\.json|gps-private-run\.test/);
  assert.equal(fs.existsSync(report),false);
  const absent=cli('replay',path.join(dir,'SECRET_COORDINATE_SENTINEL'),report);
  assert.equal(absent.status,1);assert.doesNotMatch(absent.stdout+absent.stderr,/SECRET_COORDINATE_SENTINEL/);
});
