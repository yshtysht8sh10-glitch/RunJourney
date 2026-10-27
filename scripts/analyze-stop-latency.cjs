// Read-only private input; creates a NEW report, never uploads GPS/history.
require('./sqlite-pc-runtime.cjs');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { summarizeStopLatency } = require('../src/domain/stop-latency.ts');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node scripts/analyze-stop-latency.cjs voice.json NEW-report.json');
const bytes = fs.readFileSync(input), document = JSON.parse(bytes);
if (!Array.isArray(document.entries)) throw Error('Expected entries');
const runIds = [...new Set(document.entries.flatMap(e => e.data?.runId ? [e.data.runId] : []))];
const summary = { sha256: createHash('sha256').update(bytes).digest('hex'), rows: document.entries.length,
  all: summarizeStopLatency(document.entries), runs: runIds.map(runId => summarizeStopLatency(document.entries, runId)) };
fs.writeFileSync(output, JSON.stringify(summary, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ rows: summary.rows, stages: summary.all.stages, runCount: runIds.length }, null, 2));
