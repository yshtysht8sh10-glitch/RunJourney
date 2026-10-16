// PC-only runner for the SAME TypeScript SQL implementation shipped to Expo.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const base = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...rest) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(base, 'src', name.slice(2)) : name, ...rest);
};
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  module._compile(result.outputText, filename);
};
const { SqliteStore } = require('../src/repositories/sqlite-store.ts');
function open(filename) {
  const native = new DatabaseSync(filename);
  let before;
  const statements = [];
  const connection = {
    async execAsync(sql) { statements.push(sql); before?.(sql); native.exec(sql); },
    async runAsync(sql, ...params) { statements.push(sql); before?.(sql); return native.prepare(sql).run(...params); },
    async getAllAsync(sql, ...params) { statements.push(sql); before?.(sql); return native.prepare(sql).all(...params); },
  };
  return { native, store: new SqliteStore(connection), statements, inject: fn => { before = fn; }, close: () => native.close() };
}
module.exports = { open };
