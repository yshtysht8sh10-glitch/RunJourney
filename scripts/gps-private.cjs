// Explicit local-only execution. Child output is never forwarded: failures may
// contain assertion values from private input. Reports contain aggregates only.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = fs.realpathSync(path.resolve(__dirname, '..'));
function outside(file, existing) {
  const resolved = existing ? fs.realpathSync(path.resolve(file)) : path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
  const relative = path.relative(root, resolved);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw Error('PRIVATE_PATH_REQUIRED');
  for (let dir=path.dirname(resolved);;dir=path.dirname(dir)) {
    if(fs.existsSync(path.join(dir,'.git')))throw Error('PRIVATE_PATH_REQUIRED');
    if(path.dirname(dir)===dir)break;
  }
  return resolved;
}
try {
  const [mode, value, destination, ...extra] = process.argv.slice(2);
  if (extra.length || !destination || !['synthetic','replay'].includes(mode)) throw Error('USAGE: gps-private.cjs synthetic MINUTES|replay PRIVATE_JSON NEW_PRIVATE_REPORT');
  const report = outside(destination, false);
  if (fs.existsSync(report)) throw Error('REPORT_ALREADY_EXISTS');
  const env = { ...process.env, RUNJOURNEY_PRIVATE_REPORT: report };
  delete env.RUNJOURNEY_PRIVATE_INPUT; delete env.RUNJOURNEY_PRIVATE_MINUTES;
  if (mode === 'synthetic') {
    if (!/^\d+$/.test(value) || +value < 1 || +value > 240) throw Error('MINUTES_1_TO_240');
    env.RUNJOURNEY_PRIVATE_MINUTES = value;
  } else {
    env.RUNJOURNEY_PRIVATE_INPUT = outside(value, true);
    if (fs.statSync(env.RUNJOURNEY_PRIVATE_INPUT).size > 32*1024*1024) throw Error('REPLAY_INPUT_LIMIT');
  }
  const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', '--runTestsByPath', 'src/utils/__tests__/gps-private-run.test.ts', '--silent'],
    { cwd: root, env, encoding: 'utf8', maxBuffer: 1024*1024, timeout: 300000 });
  if (result.status !== 0) throw Error('PRIVATE_RUN_FAILED_NO_INPUT_PRINTED');
  const output = JSON.parse(fs.readFileSync(report, 'utf8'));
  process.stdout.write(JSON.stringify({ status: 'passed', inputFixes: output.inputFixes, virtualMinutes: output.virtualMinutes, paceSlots: output.paceSlots })+'\n');
} catch (error) {
  const message = String(error.message);
  // File-system errors can embed paths. Only our fixed upper-case codes escape.
  process.stderr.write(/^[A-Z0-9_ :|.-]+$/.test(message) ? message+'\n' : 'PRIVATE_RUN_FAILED\n');
  process.exitCode = 1;
}
