// Read-only analysis. Private input/report stay outside Git; no network access.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node scripts/analyze-voice-log.cjs input.json NEW-report.json');
const raw = fs.readFileSync(input), document = JSON.parse(raw);
if (!Array.isArray(document.entries)) throw Error('entries array required');
const uniqueRows = [...new Map(document.entries.map(e => [JSON.stringify(e), e])).values()];
const byId = new Map();
for (const [index, e] of uniqueRows.entries()) {
  // Non-speech diagnostics may have no notification ID; never merge them.
  const key = e.id ?? `diagnostic-row:${index}`;
  const rows = byId.get(key) ?? []; rows.push(e); byId.set(key, rows);
}
const events = [...byId].map(([id, rows]) => {
  const first = rows[0], last = rows.at(-1), started = rows.find(e => e.status === 'STARTED');
  const queued = rows.find(e => e.status === 'QUEUED');
  return { id, type: first.type, statuses: [...new Set(rows.map(e => e.status))], terminal: last.status,
    generatedAt: first.generatedAt ?? null, jsQueuedAt: first.queuedAt ?? null,
    nativeQueuedAt: queued?.nativeQueuedAt ?? null, startedAt: started?.startedAt ?? null,
    terminalAt: last.loggedAt, expiresAt: first.expiresAt, priority: first.priority,
    jsToNativeMs: first.queuedAt && queued?.nativeQueuedAt ? queued.nativeQueuedAt - first.queuedAt : null,
    queueWaitMs: queued?.nativeQueuedAt && started?.startedAt ? started.startedAt - queued.nativeQueuedAt : null,
    generationToNativeAuditMs: first.queuedAt ? first.loggedAt - first.queuedAt : null };
});
const counts = {};
for (const e of events) {
  const c = counts[e.type] ??= { uniqueIds: 0, lifecycle: {}, terminal: {} }; c.uniqueIds++;
  for (const s of e.statuses) c.lifecycle[s] = (c.lifecycle[s] ?? 0) + 1;
  c.terminal[e.terminal] = (c.terminal[e.terminal] ?? 0) + 1;
}
const verification = {};
for (const v of document.verification ?? []) for (const [key, value] of Object.entries(v)) {
  if (typeof value !== 'boolean') continue;
  const c = verification[key] ??= { pass: new Set(), fail: new Set() };
  c[value ? 'pass' : 'fail'].add(v.id);
}
const report = { sha256: createHash('sha256').update(raw).digest('hex'), version: document.version,
  rows: document.entries.length, exactDuplicateRows: document.entries.length - uniqueRows.length,
  uniqueIds: events.length, from: new Date(Math.min(...uniqueRows.map(e => e.loggedAt))).toISOString(),
  to: new Date(Math.max(...uniqueRows.map(e => e.loggedAt))).toISOString(), counts,
  verification: Object.fromEntries(Object.entries(verification).map(([k, v]) => [k, { pass: v.pass.size, fail: v.fail.size }])),
  caveats: ['DONE means TTS completion, not listener hearing.', 'generatedAt is unavailable in older logs; queuedAt is JS payload timestamp.', 'No AppState, OS audio volume, CPU or execution trace: scheduler/OS cause cannot be proven.', 'Counts refer to retained log only; distinct lifecycle statuses are not duplicate events.'],
  events };
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ rows: report.rows, uniqueIds: events.length, counts, verification: report.verification }, null, 2));
