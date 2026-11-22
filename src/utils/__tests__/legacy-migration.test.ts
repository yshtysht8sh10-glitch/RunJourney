import { connection, injectFault, resetNative } from '../../test/native-driver';
import { syntheticRun } from '../../test/long-run';
import { SqliteStore, canonical } from '../../repositories/sqlite-store';
import { hashText } from '../../domain/pages';
import { LEGACY_DRAFT_KEY, LEGACY_RUNS_KEY, LEGACY_MIGRATION_SOURCE, legacyFingerprint, migrateLegacyPlan, readLegacyPlan, type LegacyEntry } from '../../repositories/legacy-migration';

const entries = (values: Record<string, string>): LegacyEntry[] => Object.entries(values).map(([key, text]) => ({ key, length: Array.from(text).length, sha256: hashText(text) }));
function reader(values: Record<string, string>, size = 17) {
  return { read: jest.fn(async (_token: string, key: string, offset: number) => {
    const points = Array.from(values[key]); const text = points.slice(offset, offset + size).join('');
    return { text, nextOffset: offset + Array.from(text).length, done: offset + Array.from(text).length === points.length };
  }) };
}
const run = (id = 'synthetic-legacy') => ({ ...syntheticRun(.01, 5000, id), extension: { unknown: 'keep😀' } });
let store: SqliteStore;
beforeEach(() => { resetNative(); store = new SqliteStore(connection); });
afterEach(() => { injectFault(); });

test('exact copy keeps history order, expired trash, unknown fields, raw GPS/events, settings strings and ended draft', async () => {
  const runs = [run('a'), { ...run('expired'), trashedAt: 1 }], draft = run('ended-draft');
  const values = { [LEGACY_RUNS_KEY]: JSON.stringify(runs), [LEGACY_DRAFT_KEY]: JSON.stringify(draft), '@runjourney/new-future/v1': ' { "unknown": "😀" } ', '@runjourney/run-features/v1': '{"autoStop":true,"break":false}' };
  const before = JSON.stringify(values), plan = await readLegacyPlan(reader(values), 'session', entries(values));
  const report = await migrateLegacyPlan(store, plan);
  expect(await store.snapshot()).toEqual({ ...plan.snapshot, protectedIds: ['a', 'expired', 'ended-draft'] });
  expect(JSON.stringify(values)).toBe(before);
  expect(report.runs).toBe(2); expect(report.draft).toBe(true);
  expect(JSON.parse((await store.legacyMigrationReport(LEGACY_MIGRATION_SOURCE))!).fingerprint).toBe(plan.fingerprint);
});
test('empty settings-only legacy snapshot is preserved without creating a RUN', async () => {
  const values = { '@runjourney/voice-announcement/v1': 'off' };
  const plan = await readLegacyPlan(reader(values), 's', entries(values));
  await migrateLegacyPlan(store, plan); expect((await store.snapshot()).settings).toEqual(values);
});
test('UTF8 hash and codepoint cursor preserve emoji across small chunks', async () => {
  const values = { '@runjourney/extension/v1': '😀'.repeat(500) };
  const r = reader(values, 1), plan = await readLegacyPlan(r, 's', entries(values));
  expect(plan.snapshot.settings).toEqual(values); expect(r.read).toHaveBeenCalledTimes(500);
});
test.each(['run', 'setting', 'marker'])('nonempty target %s is never merged or overwritten', async kind => {
  if (kind === 'run') await store.complete(run());
  else if (kind === 'setting') await store.setSetting('@runjourney/a', 'old');
  else await store.atomic(s => s.db.runAsync('INSERT INTO migration_log(source,report) VALUES(?,?)', 'other', '{}'));
  const before = canonical(await store.snapshot());
  const plan = await readLegacyPlan(reader({}), 's', []);
  await expect(migrateLegacyPlan(store, plan)).rejects.toThrow('空ではありません');
  expect(canonical(await store.snapshot())).toBe(before);
});
test('corrupt JSON, duplicate IDs and history/draft identity collision fail before writes', async () => {
  const cases: Record<string, string>[] = [{ [LEGACY_RUNS_KEY]: 'broken' }, { [LEGACY_RUNS_KEY]: '{}' },
    { [LEGACY_RUNS_KEY]: JSON.stringify([run(), run()]) },
    { [LEGACY_RUNS_KEY]: JSON.stringify([run()]), [LEGACY_DRAFT_KEY]: JSON.stringify(run()) },
    { [LEGACY_DRAFT_KEY]: 'null' }];
  for (const values of cases) {
    await expect(readLegacyPlan(reader(values), 's', entries(values))).rejects.toThrow();
  }
  expect((await store.snapshot()).runs).toEqual([]);
});
test('Native chunk corruption, skipping, duplicate offset and early done are rejected', async () => {
  const values = { '@runjourney/a': 'abcdef' }, e = entries(values);
  for (const result of [{ text: 'xxx', nextOffset: 3, done: false }, { text: 'ab', nextOffset: 3, done: false },
    { text: '', nextOffset: 0, done: false }, { text: 'ab', nextOffset: 2, done: true }]) {
    await expect(readLegacyPlan({ read: async () => result }, 's', e)).rejects.toThrow();
  }
});
test('duplicate keys, unsupported keys, invalid hash and excessive source size fail closed', () => {
  const e = entries({ '@runjourney/a': 'a' })[0];
  for (const list of [[e, e], [{ ...e, key: 'unrelated' }], [{ ...e, sha256: 'x' }], [{ ...e, length: 9 * 1024 * 1024 }]]) expect(() => legacyFingerprint(list)).toThrow();
});
test('unsupported pace metadata removed by normal serializer causes rollback, not silent success', async () => {
  const legacy = { ...run(), paceWorkout: { future: true } };
  const values = { [LEGACY_RUNS_KEY]: JSON.stringify([legacy]) };
  const plan = await readLegacyPlan(reader(values), 's', entries(values));
  await expect(migrateLegacyPlan(store, plan)).rejects.toThrow('一致しません');
  expect((await store.snapshot()).runs).toEqual([]);
  expect(await store.legacyMigrationReport(LEGACY_MIGRATION_SOURCE)).toBeNull();
});
test('write failure rolls back every table and marker; retry from new store succeeds', async () => {
  const values = { [LEGACY_RUNS_KEY]: JSON.stringify([run()]), '@runjourney/a': 'value' };
  const plan = await readLegacyPlan(reader(values), 's', entries(values));
  injectFault(sql => { if (sql.startsWith('INSERT INTO settings')) throw Error('synthetic disk failure'); });
  await expect(migrateLegacyPlan(store, plan)).rejects.toThrow('synthetic disk failure'); injectFault();
  expect(await store.snapshot()).toEqual({ runs: [], draft: null, settings: {}, protectedIds: [] });
  expect(await store.legacyMigrationReport(LEGACY_MIGRATION_SOURCE)).toBeNull();
  store = new SqliteStore(connection); await migrateLegacyPlan(store, plan);
  expect((await store.snapshot()).runs).toEqual([run()]);
  await expect(migrateLegacyPlan(store, plan)).rejects.toThrow('空ではありません');
});
test('marker insertion failure also rolls back validated copies', async () => {
  const values = { [LEGACY_RUNS_KEY]: JSON.stringify([run()]) }, plan = await readLegacyPlan(reader(values), 's', entries(values));
  injectFault(sql => { if (sql.startsWith('INSERT INTO migration_log')) throw Error('marker failure'); });
  await expect(migrateLegacyPlan(store, plan)).rejects.toThrow('marker failure'); injectFault();
  expect((await store.snapshot()).runs).toEqual([]);
});
