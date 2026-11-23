// Offline analysis of a private backup. No network or writes to run history.
require('./sqlite-pc-runtime.cjs');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { decodeBackup } = require('../src/repositories/sqlite-backup.ts');
const { effectiveRun } = require('../src/utils/run-model.ts');
const { recoveryAnalysis } = require('../src/domain/recovery-analysis.ts');
(async () => {
  const backup = await decodeBackup(fs.readFileSync(process.argv[2], 'utf8'), async text => createHash('sha256').update(text).digest('hex'));
  const runs = backup.snapshot.runs.filter(r => !r.trashedAt).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  if (!runs.length) throw Error('No active history');
  const history = runs.map(r => { const e = effectiveRun(r); return { id: r.id, startedAt: r.startedAt, endedAt: r.endedAt,
    distanceMeters: e.distanceMeters, activeRunningTime: e.activeRunningTime, kmPerHour: e.pace.kmPerHour }; });
  console.log(JSON.stringify(recoveryAnalysis(history, runs[0], true), null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
