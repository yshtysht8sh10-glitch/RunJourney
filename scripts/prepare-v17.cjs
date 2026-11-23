// PC-only compatibility reader. Never opens or migrates the phone database.
require('./sqlite-pc-runtime.cjs');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { constants } = require('node:fs');
const { parseReviewFile } = require('../src/domain/review.ts');
const { sourceFromRun, hashText } = require('../src/domain/pages.ts');
const { pagedFileLines } = require('../src/domain/paged-file.ts');
async function prepare(input, output) {
  if (!input || !output) throw Error('Usage: npm run prepare:v17 -- --input backup-copy.json --output new-file.ndjson');
  input = path.resolve(input); output = path.resolve(output);
  if (input.toLowerCase() === output.toLowerCase() || !output.toLowerCase().endsWith('.ndjson')) throw Error('原本とは別の新規.ndjson出力先を指定してください');
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw Error('旧JSON互換変換は50MiBまでです。より大きい記録にはページ形式のExportを使用してください');
  const original = await fs.readFile(input), fingerprint = crypto.createHash('sha256').update(original).digest('hex');
  const result = await parseReviewFile(original.toString('utf8').replace(/^\uFEFF/, ''), async value => hashText(value));
  if (!result.runs) throw Error('走行バックアップを指定してください。診断単体は対象外です');
  const runs = result.runs.filter(r => r.trashedAt === undefined);
  const temporary = output + `.partial-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    for await (const line of pagedFileLines((function*(){ for(const run of runs) yield sourceFromRun(run); })())) await handle.write(line);
    await handle.sync(); await handle.close(); handle = undefined;
    const after = crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');
    if (after !== fingerprint) throw Error('変換中に入力ファイルが変化しました。変換結果は公開しません');
    await fs.copyFile(temporary, output, constants.COPYFILE_EXCL);
    return { runs: runs.length, points: runs.reduce((n,r)=>n+r.points.length,0), inputSha256: fingerprint };
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
}
if (require.main === module) {
  const args=process.argv.slice(2), input=args[args.indexOf('--input')+1], output=args[args.indexOf('--output')+1];
  if(!args.includes('--input')||!args.includes('--output')) { console.error('Usage: npm run prepare:v17 -- --input backup-copy.json --output new-file.ndjson'); process.exitCode=1; }
  else prepare(input,output).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports = { prepare };
