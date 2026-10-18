const test = require("node:test"),
  assert = require("node:assert/strict"),
  { DatabaseSync } = require("node:sqlite");
require("./sqlite-pc-runtime.cjs");
const {
  SqliteStore,
  V17_SCHEMA,
  canonical,
} = require("../src/repositories/sqlite-store.ts");
const { SqlitePagedStore } = require("../src/repositories/paged-store.ts");
const {
  sourceFromRun,
  hashText,
  iteratePages,
} = require("../src/domain/pages.ts");
const {
  prepareManifest,
  validateManifest,
  uploadPaged,
  openPaged,
  PagedSyncQueue,
} = require("../src/sync/paged-protocol.ts");
const { pagedLapAnalysis } = require("../src/domain/paged-analysis.ts");
const { effectiveRun } = require("../src/utils/run-model.ts");
const { syntheticRun } = require("../src/test/long-run.ts");
function fixture() {
  const native = new DatabaseSync(":memory:");
  let fault;
  const db = {
    async execAsync(sql) {
      fault?.(sql);
      native.exec(sql);
    },
    async runAsync(sql, ...p) {
      fault?.(sql);
      return native.prepare(sql).run(...p);
    },
    async getAllAsync(sql, ...p) {
      fault?.(sql);
      return native.prepare(sql).all(...p);
    },
  };
  return {
    native,
    db,
    store: new SqliteStore(db),
    inject: (fn) => {
      fault = fn;
    },
  };
}
async function seedV17(f, runs) {
  f.native.exec(`PRAGMA foreign_keys=ON;${V17_SCHEMA}PRAGMA user_version=1`);
  for (const run of runs) {
    const metrics = effectiveRun(run);
    f.native
      .prepare(
        "INSERT INTO runs(id,status,started_at,ended_at,distance,trashed_at,effective_distance,effective_time) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        run.id,
        "draft",
        run.startedAt,
        run.endedAt,
        run.distanceMeters,
        null,
        metrics.distanceMeters,
        metrics.activeRunningTime,
      );
    const source = sourceFromRun(run);
    for (const kind of [
      "gps",
      "events",
      "metadata",
      "operations",
      "diagnostics",
    ]) {
      let seq = 0;
      for await (const page of iteratePages(source, kind)) {
        for (const value of page.items) {
          if (kind === "gps") {
            f.native
              .prepare("INSERT INTO gps_points VALUES(?,?,?)")
              .run(run.id, seq, canonical(value));
            f.native
              .prepare("INSERT INTO gps_order VALUES(?,?,?)")
              .run(run.id, seq, seq);
          } else {
            const table = kind === "events" ? "run_events" : `run_${kind}`;
            f.native
              .prepare(`INSERT INTO ${table} VALUES(?,?,?)`)
              .run(run.id, seq, kind === "events" ? canonical(value) : value);
          }
          seq++;
        }
      }
    }
    f.native
      .prepare("UPDATE runs SET status='completed' WHERE id=?")
      .run(run.id);
  }
}
function rawSnapshot(f) {
  return canonical(
    [
      "runs",
      "gps_points",
      "gps_order",
      "run_events",
      "run_metadata",
      "run_operations",
      "run_diagnostics",
    ].map((table) =>
      f.native.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all(),
    ),
  );
}
test("v17 additive migration preserves every original row and compatibility reads", async () => {
  const f = fixture();
  try {
    const run = syntheticRun(0.5);
    await seedV17(f, [run]);
    const before = rawSnapshot(f);
    await f.store.atomic(async () => {});
    assert.equal(f.native.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(rawSnapshot(f), before);
    assert.equal(
      hashText(canonical(await f.store.getRun(run.id))),
      hashText(canonical(run)),
    );
    const source = new SqlitePagedStore(f.store).source(run.id);
    assert.deepEqual(
      await prepareManifest(source),
      await prepareManifest(sourceFromRun(run)),
    );
  } finally {
    f.native.close();
  }
});
test("migration IO failure rolls back DDL, version and indexes; fresh retry works", async () => {
  const f = fixture();
  try {
    await seedV17(f, [syntheticRun(0.5)]);
    const before = rawSnapshot(f);
    let writes = 0;
    f.inject((sql) => {
      if (
        sql.startsWith("INSERT OR REPLACE INTO run_row_hash") &&
        ++writes === 5
      )
        throw Error("synthetic IOERR");
    });
    await assert.rejects(
      f.store.atomic(async () => {}),
      /IOERR/,
    );
    assert.equal(f.native.prepare("PRAGMA user_version").get().user_version, 1);
    assert.equal(rawSnapshot(f), before);
    assert.equal(
      f.native
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name='run_row_hash'",
        )
        .get().n,
      0,
    );
    f.inject();
    await new SqliteStore(f.db).atomic(async () => {});
    assert.equal(rawSnapshot(f), before);
  } finally {
    f.native.close();
  }
});
test("corrupt legacy run is quarantined without hiding healthy metadata", async () => {
  const f = fixture();
  try {
    const bad = syntheticRun(0.1, 5000, "bad"),
      good = syntheticRun(0.1, 5000, "good"),
      nullMetadata = syntheticRun(0.1, 5000, "null-metadata");
    await seedV17(f, [bad, good, nullMetadata]);
    f.native.prepare("UPDATE run_metadata SET payload='null' WHERE run_id=?").run(nullMetadata.id);
    f.native.exec("DROP TRIGGER raw_gps_delete");
    f.native
      .prepare("DELETE FROM gps_order WHERE run_id=? AND position=?")
      .run("bad", bad.points.length - 1);
    f.native
      .prepare("DELETE FROM gps_points WHERE run_id=? AND seq=?")
      .run("bad", bad.points.length - 1);
    await f.store.atomic(async () => {});
    const paged = new SqlitePagedStore(f.store),
      rows = await paged.list();
    assert.equal(rows.length, 3);
    assert.ok(rows.find((r) => r.id === "bad").error);
    assert.ok(!rows.find((r) => r.id === "good").error);
    assert.ok(rows.find((r) => r.id === nullMetadata.id).error);
    assert.ok((await paged.source("good").read("gps", 0)).items.length > 0);
    await assert.rejects(prepareManifest(paged.source("bad")));
  } finally {
    f.native.close();
  }
});
test("page hashes detect corruption and positional omission/duplication across boundaries", async () => {
  const f = fixture();
  try {
    const run = syntheticRun(0.5);
    await f.store.complete(run);
    const paged = new SqlitePagedStore(f.store);
    f.native
      .prepare("UPDATE gps_order SET seq=0 WHERE run_id=? AND position=128")
      .run(run.id);
    await assert.rejects(paged.source(run.id).summary(), /重複/);
    await assert.rejects(paged.source(run.id).read("gps", 128), /境界/);
    f.native
      .prepare("UPDATE gps_order SET seq=128 WHERE run_id=? AND position=128")
      .run(run.id);
    f.native.exec("DROP TRIGGER raw_gps_update");
    f.native
      .prepare("UPDATE gps_points SET payload=? WHERE run_id=? AND seq=128")
      .run("{}", run.id);
    await assert.rejects(paged.source(run.id).read("gps", 128), /SHA-256/);
  } finally {
    f.native.close();
  }
});
test("streamed 5-minute laps match shared whole-run analysis without retaining GPS", async () => {
  const f = fixture();
  try {
    const run = syntheticRun(2);
    await f.store.complete(run);
    const actual = await pagedLapAnalysis(
        new SqlitePagedStore(f.store).source(run.id),
      ),
      expected = effectiveRun(run).laps();
    assert.equal(actual.laps.length, expected.length);
    actual.laps.forEach((lap, i) =>
      assert.ok(
        Math.abs(lap.distanceMeters - expected[i].distanceMeters) < 1e-6,
      ),
    );
  } finally {
    f.native.close();
  }
});
test("malformed/duplicate/incomplete manifest is rejected and no account crossover occurs", async () => {
  const manifest = await prepareManifest(sourceFromRun(syntheticRun(0.5)));
  assert.throws(() =>
    validateManifest({
      ...manifest,
      pages: [manifest.pages[0], ...manifest.pages],
    }),
  );
  assert.throws(() =>
    validateManifest({ ...manifest, pages: manifest.pages.slice(1) }),
  );
  const remote = {
    get: async () => null,
    list: async () => [],
    getBlob: async () => null,
    putBlob: async () => {},
    publish: async () => {},
  };
  await assert.rejects(
    openPaged(
      {
        schemaVersion: 2,
        revision: 1,
        id: "x",
        hash: "a".repeat(64),
        complete: true,
        ownerUid: "alice",
        summary: manifest.summary,
      },
      "bob",
      remote,
    ),
    /所有者/,
  );
  let saved;
  const persistence = {
    load: async () => saved ?? null,
    save: async (text) => {
      saved = text;
    },
  };
  const a = new PagedSyncQueue(
    "alice",
    persistence,
    () => sourceFromRun(syntheticRun(0.5)),
    remote,
  );
  await a.open();
  await a.enqueue(manifest.summary.id);
  const b = new PagedSyncQueue(
    "bob",
    persistence,
    () => sourceFromRun(syntheticRun(0.5)),
    remote,
  );
  await assert.rejects(b.open(), /所有者/);
});
test("same Run ID with changed content does not overwrite a completed paged cloud run", async () => {
  const blobs = new Map(),
    headers = new Map();
  const remote = {
    get: async (id) => headers.get(id) ?? null,
    list: async () => [...headers.values()],
    getBlob: async (h) => blobs.get(h) ?? null,
    putBlob: async (h, t) => {
      blobs.set(h, t);
    },
    publish: async (h) => {
      headers.set(h.id, h);
    },
  };
  const run = syntheticRun(0.5),
    source = sourceFromRun(run);
  await uploadPaged(source, "alice", remote);
  const before = canonical([...headers]);
  await assert.rejects(
    uploadPaged(
      sourceFromRun({ ...run, distanceMeters: run.distanceMeters + 1 }),
      "alice",
      remote,
    ),
    /上書き/,
  );
  assert.equal(canonical([...headers]), before);
});
