const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
require("./sqlite-pc-runtime.cjs");
const {
  SqliteStore,
  canonical,
} = require("../src/repositories/sqlite-store.ts");
const { SqlitePagedStore } = require("../src/repositories/paged-store.ts");
const { syntheticRun } = require("../src/test/long-run.ts");
const {
  hashText,
  iteratePages,
  PAGE_BYTES,
  PAGE_ROWS,
} = require("../src/domain/pages.ts");
const { statistics, journey, streak } = require("../src/domain/review.ts");
const { PagedSyncQueue, openPaged } = require("../src/sync/paged-protocol.ts");
const { pagedFileLines } = require("../src/domain/paged-file.ts");
const [hoursText, countText = "1", intervalText = "5000"] =
    process.argv.slice(2),
  hours = Number(hoursText),
  count = Number(countText),
  interval = Number(intervalText);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "runjourney-long-"));
let native;
let forbidGps = false,
  maxRows = 0,
  queries = 0;
function open() {
  native = new DatabaseSync(path.join(root, "case.sqlite"));
  const db = {
    async execAsync(sql) {
      native.exec(sql);
    },
    async runAsync(sql, ...args) {
      return native.prepare(sql).run(...args);
    },
    async getAllAsync(sql, ...args) {
      queries++;
      if (
        forbidGps &&
        /SELECT[^]*payload[^]*FROM[^]*(gps_points|gps_order)/i.test(sql)
      )
        throw Error("metadata path read GPS payload");
      const rows = native.prepare(sql).all(...args);
      if (
        /SELECT[^]*payload[^]*FROM[^]*(gps_points|gps_order)/i.test(sql) &&
        /LIMIT/i.test(sql)
      ) {
        maxRows = Math.max(maxRows, rows.length);
        assert.ok(rows.length <= PAGE_ROWS);
      }
      return rows;
    },
  };
  return new SqliteStore(db);
}
function memory() {
  global.gc?.();
  return process.memoryUsage();
}
async function main() {
  let store = open(),
    expected = new Map(),
    totalPoints = 0,
    rawBytes = 0;
  const initial = memory(),
    saveStart = performance.now();
  for (let i = 0; i < count; i++) {
    let run = syntheticRun(
      hours,
      interval,
      `synthetic-long-${hours}-${interval}-${i}`,
    );
    const pointHash = createHash("sha256");
    for (const p of run.points) {
      const text = canonical(p) + "\n";
      pointHash.update(text);
      rawBytes += Buffer.byteLength(text);
    }
    expected.set(run.id, {
      points: run.points.length,
      hash: pointHash.digest("hex"),
      diagnostics: hashText(canonical(run.diagnostics)),
    });
    totalPoints += run.points.length;
    await store.complete(run);
    run = null;
  }
  const saveMs = performance.now() - saveStart;
  native.close();
  store = open();
  let paged = new SqlitePagedStore(store);
  const beforeMetadata = memory(),
    listStart = performance.now();
  forbidGps = true;
  const summaries = await paged.list(100);
  assert.equal(summaries.length, count);
  assert.equal(statistics(summaries).count, count);
  journey(summaries);
  streak(summaries, { now: Date.parse("2026-11-01T00:00:00Z") });
  forbidGps = false;
  const listMs = performance.now() - listStart,
    afterMetadata = memory();
  const readStart = performance.now();
  let pageCount = 0,
    maxPageBytes = 0;
  for (const meta of summaries) {
    const expectedRun = expected.get(meta.id),
      hasher = createHash("sha256");
    let seen = 0,
      last = -Infinity;
    for await (const page of iteratePages(paged.source(meta.id), "gps")) {
      pageCount++;
      const size = Buffer.byteLength(canonical(page));
      maxPageBytes = Math.max(maxPageBytes, size);
      assert.ok(size <= PAGE_BYTES);
      for (const point of page.items) {
        assert.ok(point.timestamp > last);
        last = point.timestamp;
        hasher.update(canonical(point) + "\n");
        seen++;
      }
    }
    assert.equal(seen, expectedRun.points);
    assert.equal(hasher.digest("hex"), expectedRun.hash);
    const diagnostics = createHash("sha256");
    for await (const p of iteratePages(paged.source(meta.id), "diagnostics"))
      for (const text of p.items) diagnostics.update(text);
    assert.equal(diagnostics.digest("hex"), expectedRun.diagnostics);
  }
  const readMs = performance.now() - readStart,
    afterRead = memory();
  const target = summaries[0],
    headers = new Map();
  fs.mkdirSync(path.join(root, "cloud"));
  let writes = 0,
    gets = 0,
    failAt = 7,
    failed = false;
  const remote = {
    async get(id) {
      return headers.get(id) ?? null;
    },
    async list() {
      return [...headers.values()];
    },
    async getBlob(hash) {
      gets++;
      const p = path.join(root, "cloud", hash);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    },
    async putBlob(hash, text) {
      if (!failed && ++writes === failAt) {
        failed = true;
        throw Error("synthetic network cut");
      }
      assert.equal(hashText(text), hash);
      const p = path.join(root, "cloud", hash);
      if (fs.existsSync(p)) assert.equal(fs.readFileSync(p, "utf8"), text);
      else fs.writeFileSync(p, text);
    },
    async publish(header) {
      const prior = headers.get(header.id);
      assert.ok(!prior || prior.hash === header.hash);
      headers.set(header.id, header);
    },
  };
  const key = "@runjourney/sync/long-test",
    queueStore = {
      load: () => store.getSetting(key),
      save: (text) => store.setSetting(key, text),
    };
  let queue = new PagedSyncQueue(
    "synthetic-owner",
    queueStore,
    (id) => paged.source(id),
    remote,
  );
  const syncStart = performance.now();
  await queue.open();
  await queue.enqueue(target.id);
  const queueBytes = Buffer.byteLength(await queueStore.load());
  assert.ok(queueBytes < 600000);
  await queue.flush(0, true);
  assert.equal(queue.state[0].status, "retrying");
  assert.equal(headers.size, 0);
  const uploadedBeforeRetry = fs.readdirSync(path.join(root, "cloud")).length;
  assert.ok(uploadedBeforeRetry > 0);
  queue = new PagedSyncQueue(
    "synthetic-owner",
    queueStore,
    (id) => paged.source(id),
    remote,
  );
  await queue.open();
  await queue.flush(1, true);
  assert.equal(queue.state.length, 0);
  assert.equal(headers.size, 1);
  const filesAfterRetry = fs.readdirSync(path.join(root, "cloud")).length;
  await queue.enqueue(target.id);
  await queue.flush(2, true);
  assert.equal(
    fs.readdirSync(path.join(root, "cloud")).length,
    filesAfterRetry,
  );
  const getsBeforeList = gets;
  assert.equal((await remote.list()).length, 1);
  assert.equal(gets, getsBeforeList);
  const reader = await openPaged(
    headers.get(target.id),
    "synthetic-owner",
    remote,
  );
  let cloudPoints = 0;
  for await (const page of iteratePages(reader, "gps"))
    cloudPoints += page.items.length;
  assert.equal(cloudPoints, target.pointCount);
  const syncMs = performance.now() - syncStart,
    afterSync = memory();
  // Stream a browser fixture with bounded lines, never one giant JSON value.
  const exportPath = process.env.RUNJOURNEY_LONG_FIXTURE;
  let exportBytes = 0;
  if (exportPath) {
    fs.mkdirSync(path.dirname(path.resolve(exportPath)), { recursive: true });
    const fd = fs.openSync(exportPath, "w");
    try {
      for await (const line of pagedFileLines([paged.source(target.id)])) {
        fs.writeSync(fd, line);
        exportBytes += Buffer.byteLength(line);
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, "cloud", headers.get(target.id).hash),
        "utf8",
      ),
    ),
    gpsDescriptor = manifest.pages.find((p) => p.kind === "gps");
  fs.writeFileSync(path.join(root, "cloud", gpsDescriptor.hash), "{}");
  await assert.rejects(reader.read("gps", 0), /SHA-256/);
  assert.equal((await remote.list()).length, 1);
  const healthy = syntheticRun(0.01, 5000, "synthetic-healthy");
  await store.complete(healthy);
  native.exec("DROP TRIGGER raw_gps_update");
  native
    .prepare("UPDATE gps_points SET payload=? WHERE run_id=? AND seq=0")
    .run('{"latitude":0,"longitude":0,"timestamp":0}', target.id);
  await assert.rejects(paged.source(target.id).read("gps", 0), /SHA-256/);
  assert.ok((await paged.list(100)).some((r) => r.id === target.id));
  assert.ok((await paged.source(healthy.id).read("gps", 0)).items.length > 0);
  const report = {
    case: count === 11 ? "30min x 11" : `${hours}h @ ${interval / 1000}s`,
    hours,
    count,
    intervalMs: interval,
    totalPoints,
    gpsPages: pageCount,
    rawGpsBytes: rawBytes,
    databaseBytes: fs.statSync(path.join(root, "case.sqlite")).size,
    walBytes: fs.existsSync(path.join(root, "case.sqlite-wal"))
      ? fs.statSync(path.join(root, "case.sqlite-wal")).size
      : 0,
    saveMs,
    listMs,
    readMs,
    syncMs,
    queueBytes,
    maxRows,
    maxPageBytes,
    uploadedBeforeRetry,
    uniqueCloudBlobs: filesAfterRetry,
    exportBytes,
    heapLimitMiB: 128,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    initialHeapMiB: initial.heapUsed / 1048576,
    metadataHeapDeltaMiB:
      (afterMetadata.heapUsed - beforeMetadata.heapUsed) / 1048576,
    readHeapMiB: afterRead.heapUsed / 1048576,
    syncHeapMiB: afterSync.heapUsed / 1048576,
    queries,
    status: "passed",
  };
  native.close();
  native = null;
  console.log(JSON.stringify(report));
}
main()
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(() => {
    native?.close();
    const absolute = path.resolve(root),
      prefix = path.resolve(os.tmpdir()) + path.sep + "runjourney-long-";
    assert.ok(absolute.startsWith(prefix));
    fs.rmSync(absolute, { recursive: true });
  });
