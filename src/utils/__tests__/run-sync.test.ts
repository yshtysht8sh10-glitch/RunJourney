import {
  RunSyncQueue,
  upload,
  download,
  Transport,
  Manifest,
  SyncConflict,
} from "../../sync/protocol";
import { demoRuns } from "../../web/demo";
import { createHash } from "crypto";
const digest = async (text: string) =>
  createHash("sha256").update(text).digest("hex");
const run = demoRuns(Date.parse("2026-10-17T03:00:00Z"))[0];
function fixture() {
  let saved: string | null = null,
    fail = false;
  const manifests = new Map<string, Manifest>(),
    chunks = new Map<string, string>();
  const remote: Transport = {
    getManifest: async (id) => manifests.get(id) ?? null,
    getChunk: async (id, hash, index) => {
      if (!chunks.has(`${id}/${hash}/${index}`)) throw new Error("missing");
      return chunks.get(`${id}/${hash}/${index}`)!;
    },
    putChunk: async (id, hash, index, data) => {
      if (fail) throw new Error("offline");
      chunks.set(`${id}/${hash}/${index}`, data);
    },
    publish: async (m) => {
      const prior = manifests.get(m.id);
      if (prior && prior.hash !== m.hash) throw new SyncConflict("collision");
      manifests.set(m.id, m);
    },
    list: async () => [...manifests.values()],
  };
  const store = {
    load: async () => saved,
    save: async (text: string) => {
      saved = text;
    },
  };
  return {
    remote,
    store,
    manifests,
    chunks,
    fail: (v: boolean) => {
      fail = v;
    },
  };
}
describe("sync integrity and durable retry", () => {
  it("uploads, verifies and downloads exact original data", async () => {
    const f = fixture(),
      before = JSON.stringify(run);
    const m = await upload(run, "alice", f.remote, digest);
    expect(await download(m, "alice", f.remote, digest)).toEqual(run);
    expect(JSON.stringify(run)).toBe(before);
    expect(m.pointCount).toBe(run.points.length);
  });
  it("same-run resend is idempotent", async () => {
    const f = fixture();
    await upload(run, "alice", f.remote, digest);
    await upload(run, "alice", f.remote, digest);
    expect(f.manifests.size).toBe(1);
  });
  it("same ID different content is a conflict and keeps remote original", async () => {
    const f = fixture();
    const m = await upload(run, "alice", f.remote, digest);
    await expect(
      upload({ ...run, distanceMeters: 1 }, "alice", f.remote, digest),
    ).rejects.toBeInstanceOf(SyncConflict);
    expect(await download(m, "alice", f.remote, digest)).toEqual(run);
  });
  it("offline keeps durable queue and local run; reopened queue retries", async () => {
    const f = fixture();
    const q = new RunSyncQueue("alice", f.store, f.remote, digest);
    await q.open();
    await q.enqueue(run);
    f.fail(true);
    await q.flush(0);
    expect(q.state[0].status).toBe("retrying");
    expect(q.state[0].error).toBe("offline");
    const reopened = new RunSyncQueue("alice", f.store, f.remote, digest);
    await reopened.open();
    expect(reopened.state).toHaveLength(1);
    f.fail(false);
    await reopened.flush(2000);
    expect(reopened.state).toEqual([]);
    expect(f.manifests.size).toBe(1);
  });
  it("incomplete upload never publishes and resumes on retry", async () => {
    const f = fixture();
    const large = { ...run, extension: "x".repeat(150000) };
    let writes = 0;
    const put = f.remote.putChunk;
    f.remote.putChunk = async (...args) => {
      if (++writes === 2) throw new Error("interrupted");
      return put(...args);
    };
    await expect(upload(large, "alice", f.remote, digest)).rejects.toThrow(
      "interrupted",
    );
    expect(f.manifests.size).toBe(0);
    const m = await upload(large, "alice", f.remote, digest);
    expect(await download(m, "alice", f.remote, digest)).toEqual(large);
  });
  it("detects missing and tampered cloud payload", async () => {
    const f = fixture();
    const m = await upload(run, "alice", f.remote, digest);
    f.chunks.clear();
    await expect(download(m, "alice", f.remote, digest)).rejects.toThrow(
      "missing",
    );
    f.chunks.set(`${run.id}/${m.hash}/0`, "{}");
    await expect(download(m, "alice", f.remote, digest)).rejects.toThrow(
      "SHA-256",
    );
  });
  it("rejects schema/revision/owner/point-count mismatch", async () => {
    const f = fixture();
    const m = await upload(run, "alice", f.remote, digest);
    await expect(
      download(
        { ...m, schemaVersion: 2 } as unknown as Manifest,
        "alice",
        f.remote,
        digest,
      ),
    ).rejects.toThrow();
    await expect(download(m, "bob", f.remote, digest)).rejects.toThrow();
    await expect(
      download({ ...m, pointCount: 0 }, "alice", f.remote, digest),
    ).rejects.toThrow("GPS点数");
  });
  it("rejects invalid data before first network write", async () => {
    const f = fixture();
    await expect(
      upload({ ...run, distanceMeters: -1 }, "alice", f.remote, digest),
    ).rejects.toThrow();
    expect(f.chunks.size).toBe(0);
  });
  it("owner-bound queue cannot silently upload under another account", async () => {
    const f = fixture(),
      a = new RunSyncQueue("alice", f.store, f.remote, digest);
    await a.open();
    await a.enqueue(run);
    const b = new RunSyncQueue("bob", f.store, f.remote, digest);
    await expect(b.open()).rejects.toThrow("所有者");
  });
  it("duplicate enqueue is stable, conflicting enqueue is rejected", async () => {
    const f = fixture(),
      q = new RunSyncQueue("alice", f.store, f.remote, digest);
    await q.open();
    await Promise.all([q.enqueue(run), q.enqueue(run)]);
    expect(q.state).toHaveLength(1);
    await expect(q.enqueue({ ...run, distanceMeters: 1 })).rejects.toThrow();
  });
  it("durable save failure cannot acknowledge/remove pending work in memory", async () => {
    const f = fixture();
    let fail = false;
    const q = new RunSyncQueue(
      "alice",
      {
        load: f.store.load,
        save: async (text) => {
          if (fail) throw new Error("disk-full");
          await f.store.save(text);
        },
      },
      f.remote,
      digest,
    );
    await q.open();
    await q.enqueue(run);
    fail = true;
    await expect(q.flush()).rejects.toThrow("disk-full");
    expect(q.state).toHaveLength(1);
  });
  it("failed enqueue does not poison in-memory queue", async () => {
    const f = fixture(),
      q = new RunSyncQueue(
        "alice",
        {
          load: async () => null,
          save: async () => {
            throw new Error("disk-full");
          },
        },
        f.remote,
        digest,
      );
    await q.open();
    await expect(q.enqueue(run)).rejects.toThrow();
    expect(q.state).toHaveLength(0);
  });
});
