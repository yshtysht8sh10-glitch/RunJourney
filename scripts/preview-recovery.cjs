// Read-only local analysis. Output contains activity metrics, never GPS coordinates.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '../src', request.slice(2)) : request, ...args);
};
require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const { parseBackup } = require('../src/utils/run-backup.ts');
const { recoveryPreview } = require('../src/utils/run-recovery.ts');
const [filename, runId] = process.argv.slice(2);
if (!filename || !runId) throw new Error('Usage: node scripts/preview-recovery.cjs <Backup.json> <runId>');
const run = parseBackup(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')).runs.find(r => r.id === runId);
if (!run) throw new Error('Run not found in backup');
const preview = recoveryPreview(run);
const metrics = v => ({ distanceMeters: v.distanceMeters, activeRunningTimeMs: v.activeRunningTime, averageKmPerHour: v.pace.kmPerHour });
console.log(JSON.stringify({ runId, pointCount: run.points.length, algorithm: preview.operation.algorithm,
  current: metrics(preview.current), candidate: metrics(preview.proposed),
  autoStopRestoredDistanceMeters: preview.restoredDistanceMeters, autoStopRestoredTimeMs: preview.restoredTimeMs,
  transitions: preview.transitions, warnings: preview.warnings }, null, 2));
