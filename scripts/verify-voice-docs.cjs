// Documentation-only checks. No app/device database, browser profile or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('docs/voice-spec-interactive.html');
const script = text => text.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
const manifest = JSON.parse(read('docs/archive/voice-document-provenance-20261123.json'));
for (const item of manifest) {
  const data = fs.readFileSync(path.join(root, item.archive));
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'), item.sha256);
  const ref = item.ref === 'HEAD' ? 'a822da8' : item.ref;
  assert.ok(data.equals(execFileSync('git', ['show', `${ref}:${item.source}`], { cwd: root, maxBuffer: 2 ** 22 })));
}
assert.equal(manifest.length, 16);
assert.equal(script(html), script(read('docs/archive/pr75-test-v31/docs/voice-spec-interactive.html.txt')));
assert.ok(html.includes('href="voice-current.md"'));
for (const file of ['docs/voice-current.md', 'docs/auto-stop-current.md', 'docs/voice-history-index.md', 'docs/pre-cycling-scope-20261123.md']) {
  for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^https?:/.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: broken local link ${target}`);
  }
}
const issueIds = text => [...new Set([...text.matchAll(/#(\d+)\b/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
const ledgerIds = [...read('docs/remaining-work-20261123.md').split('## 残存Issue一覧')[1].matchAll(/^\| #(\d+) \|/gm)].map(m => Number(m[1])).sort((a, b) => a - b);
assert.equal(ledgerIds.length, 48);
assert.deepEqual(issueIds(read('docs/pre-cycling-scope-20261123.md')), ledgerIds);

// Minimal DOM models only operations used by this unchanged inline editor.
function editor(saved = []) {
  class Element {
    constructor() { this.value = ''; this.checked = false; this.children = []; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this[key] = value; }
    click() { this.onclick?.(); }
  }
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  elements.group.value = 'all';
  const key = 'runjourney-voice-spec-versions-v1';
  const storage = new Map([[key, JSON.stringify(saved)]]);
  const alerts = [], exports = [];
  const context = vm.createContext({
    document: { getElementById: id => elements[id], createElement: () => new Element() },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    alert: text => alerts.push(text), confirm: () => true, Blob,
    URL: { createObjectURL: blob => { exports.push(blob); return 'blob:fixture'; }, revokeObjectURL() {} },
    setTimeout: fn => fn(),
  });
  vm.runInContext(script(html), context);
  return { elements, storage, alerts, exports, value: expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context))) };
}
async function main() {
  const initial = editor();
  const baseline = initial.value('baseline');
  const legacy = { id: 'saved-v28', test: 'Test v28', reason: 'user edit', cells: structuredClone(baseline.cells.slice(0, -2)) };
  legacy.cells[0][0] = '△';
  const collision = { ...legacy, id: 'test-v31' };
  const loaded = editor([legacy, collision]);
  assert.equal(loaded.value('versions.find(v=>v.id==="saved-v28").cells[0][0]'), '△');
  assert.equal(loaded.value('versions.find(v=>v.id==="saved-v28").cells.length'), 29);
  assert.equal(loaded.value('versions.find(v=>v.id==="test-v31").reason'), 'user edit');
  assert.equal(loaded.value('paceVersion.id'), 'test-v31-builtin');
  const e = loaded.elements;
  const before = loaded.value('draft[0][0]');
  e.matrix.children[1].children[1].children[0].click();
  assert.notEqual(loaded.value('draft[0][0]'), before);
  e.version.value = 'docs-check'; e.testVersion.value = 'Test fixture'; e.reason.value = 'round trip';
  e.save.click();
  assert.equal(JSON.parse(loaded.storage.get('runjourney-voice-spec-versions-v1')).length, 3);
  assert.deepEqual(loaded.value('baseline.cells'), baseline.cells);
  e.export.click();
  const payload = await loaded.exports[0].text();
  const restored = editor();
  // Export includes the user-owned test-v31 ID and a renamed builtin. Importing
  // into a browser with that same saved collision preserves both identities.
  const importing = editor([collision]);
  await importing.elements.import.onchange({ target: { files: [{ text: async () => payload }], value: '' } });
  assert.ok(importing.alerts.includes('読み込みました'));
  assert.deepEqual(importing.value('versions.find(v=>v.id==="docs-check")'), loaded.value('versions.find(v=>v.id==="docs-check")'));
  const legacyPayload = JSON.stringify({ schema: 1, items: restored.value('items').slice(0, -2), columns: restored.value('cols.map(c=>c[1])'), versions: [legacy] });
  await restored.elements.import.onchange({ target: { files: [{ text: async () => legacyPayload }], value: '' } });
  assert.ok(restored.alerts.includes('読み込みました'));
  assert.equal(restored.value('versions.find(v=>v.id==="saved-v28").cells[0][0]'), '△');
  e.reset.click();
  assert.deepEqual(loaded.value('draft'), baseline.cells);
  assert.ok(loaded.value('versions.some(v=>v.id==="docs-check")'));
  console.log('PASS: 16 exact historical blobs; unchanged editor script; legacy 27-row load/import; saved-ID collision; cell editing; save/export/import; reset preserves revisions');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
