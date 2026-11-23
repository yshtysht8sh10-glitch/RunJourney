// Read-only: accepts v20+ exported voice JSON without rewriting source files.
require('./sqlite-pc-runtime.cjs');
const fs = require('node:fs');
const { summarizeFieldRun } = require('../src/domain/field-summary.ts');
const files = process.argv.slice(2);
if (!files.length) throw Error('Usage: node scripts/compare-field-runs.cjs export1.json export2.json ...');
const reports = files.flatMap(file => {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(json) ? json : json.entries;
  if (!Array.isArray(entries)) throw Error('Missing entries: ' + file);
  const ids = [...new Set(entries.map(e => e.data?.runId).filter(id => typeof id === 'string' && id !== '' && id !== 'preview'))];
  return ids.map(id => ({ source: file, ...summarizeFieldRun(entries, id) }));
});
console.log(JSON.stringify({ schema: 1, reports }, null, 2));
