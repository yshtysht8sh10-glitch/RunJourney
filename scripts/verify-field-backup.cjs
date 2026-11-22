// Read-only backup verification, restoring ONLY into a new isolated PC database.
const { open } = require('./sqlite-pc-runtime.cjs');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { decodeBackup } = require('../src/repositories/sqlite-backup.ts');
const { canonical } = require('../src/repositories/sqlite-store.ts');
const digest = async text => createHash('sha256').update(text).digest('hex');
(async () => {
  const [input, newDatabase, compare] = process.argv.slice(2);
  if (!input || !newDatabase || fs.existsSync(newDatabase)) throw Error('Usage: verify-field-backup.cjs backup.json NEW.sqlite [before.json]');
  const decoded = await decodeBackup(fs.readFileSync(input, 'utf8'), digest);
  const db = open(newDatabase);
  await db.store.restore(decoded.snapshot);
  assert.equal(canonical(await db.store.snapshot()), canonical(decoded.snapshot));
  const integrity = db.native.prepare('PRAGMA integrity_check').all();
  const foreignKeys = db.native.prepare('PRAGMA foreign_key_check').all();
  assert.equal(integrity[0].integrity_check, 'ok'); assert.equal(foreignKeys.length, 0);
  if (compare) {
    const before = await decodeBackup(fs.readFileSync(compare, 'utf8'), digest);
    assert.equal(canonical(decoded.snapshot), canonical(before.snapshot), 'Full snapshot differs (including trash, settings, protection and array order)');
  }
  console.log(JSON.stringify({ runs: decoded.snapshot.runs.length, trash: decoded.snapshot.runs.filter(r => r.trashedAt).length,
    gps: decoded.snapshot.runs.reduce((n, r) => n + r.points.length, 0), settings: Object.keys(decoded.snapshot.settings).length,
    draft: Boolean(decoded.snapshot.draft), integrity, foreignKeys, roundTrip: true, beforeEqual: compare ? true : null }));
  db.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
