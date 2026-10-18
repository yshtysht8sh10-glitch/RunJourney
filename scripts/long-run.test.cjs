const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const reports = [];
for (const [hours, count, interval] of [
  [0.5, 11, 5000],
  [10, 1, 5000],
  [12, 1, 5000],
  [24, 1, 5000],
  [24, 1, 1000],
]) {
  test(
    `long run ${hours}h x ${count}, GPS ${interval}ms, bounded paging and resumable sync`,
    { timeout: 240000 },
    () => {
      const fixture =
        hours === 24 && interval === 1000
          ? path.resolve("artifacts/web-review/synthetic-24h-1hz.ndjson")
          : "";
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          "--max-old-space-size=128",
          path.join(__dirname, "long-run-case.cjs"),
          String(hours),
          String(count),
          String(interval),
        ],
        {
          encoding: "utf8",
          timeout: 220000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, RUNJOURNEY_LONG_FIXTURE: fixture },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout.trim());
      assert.equal(report.status, "passed");
      reports.push(report);
      console.log(JSON.stringify(report));
    },
  );
}
test.after(() => {
  fs.mkdirSync("artifacts/web-review", { recursive: true });
  fs.writeFileSync(
    "artifacts/web-review/long-run-report.json",
    JSON.stringify(
      {
        runtime: process.version,
        platform: process.platform,
        generatedAt: new Date().toISOString(),
        cases: reports,
      },
      null,
      2,
    ),
  );
});
