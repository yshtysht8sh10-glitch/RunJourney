// Executable Gradle fixture: no Android compilation, artifacts, or device access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { addGuard, guardScript } = require('../plugins/with-production-build-guard');
assert.equal(addGuard(addGuard('android {}\n')), addGuard('android {}\n'));
const gradle = process.env.GRADLE_BIN;
assert.ok(gradle, 'Set GRADLE_BIN to an installed Gradle executable');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runjourney-guard-'));
fs.writeFileSync(path.join(root, 'settings.gradle'), "rootProject.name='guard-fixture'\ninclude ':app', ':library'\n");
for (const name of ['app', 'library']) fs.mkdirSync(path.join(root, name));
fs.writeFileSync(path.join(root, 'build.gradle'), "tasks.register('aggregate') { dependsOn ':app:packageRelease' }\n");
fs.writeFileSync(path.join(root, 'library/build.gradle'), "tasks.register('assembleRelease')\n");
fs.writeFileSync(path.join(root, 'app/build.gradle'), `
def variants = [
 [name:'release', applicationId:'app.runjourney.mobile', buildType:[debuggable:false]],
 [name:'renamedProd', applicationId:'app.runjourney.mobile', buildType:[debuggable:false]],
 [name:'standaloneTest', applicationId:'app.runjourney.mobile.test', buildType:[debuggable:false]],
 [name:'pace', applicationId:'app.runjourney.mobile.pace', buildType:[debuggable:false]],
 [name:'debug', applicationId:'app.runjourney.mobile', buildType:[debuggable:true]]]
ext.android = [applicationVariants: [all: { Closure action -> variants.each(action) }]]
['assembleRelease','bundleRelease','packageRelease','signReleaseBundle','packageReleaseBundle',
 'assembleRenamedProd','assembleStandaloneTest','assemblePace','assembleDebug',
 'testReleaseUnitTest'].each { tasks.register(it) }
${guardScript}
`);
const cases = [
 ['app:assembleRelease', false], ['app:bundleRelease', false], ['app:packageRelease', false],
 ['app:signReleaseBundle', false], ['app:packageReleaseBundle', false],
 ['aggregate', false], ['app:assembleRenamedProd', false],
 ['app:assembleStandaloneTest', true], ['app:assemblePace', true],
 ['app:assembleDebug', true], ['app:testReleaseUnitTest', true], ['library:assembleRelease', true],
];
for (const [task, allowed] of cases) {
  const result = spawnSync(gradle, ['-p', root, task, '--dry-run', '--console=plain'], {
    encoding:'utf8', shell:process.platform === 'win32', timeout:90000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status === 0, allowed, `${task}: ${output}`);
  if (!allowed) assert.match(output, /RunJourney production artifact blocked/);
  console.log(`PASS ${task}: ${allowed ? 'allowed' : 'blocked'}`);
}
console.log(`12 Gradle task-graph cases passed; fixture retained at ${root}`);
