import { RunRecord } from "../types/run";
import { canonical } from "../domain/review";
import { validateRuns } from "../utils/run-backup";

export const CHUNK_SIZE = 64000;
export type Manifest = {
  schemaVersion: 1;
  revision: 1;
  id: string;
  ownerUid: string;
  hash: string;
  pointCount: number;
  chunkCount: number;
  complete: true;
};
export type Digest = (value: string) => Promise<string>;
export type Transport = {
  getManifest(id: string): Promise<Manifest | null>;
  getChunk(id: string, hash: string, index: number): Promise<string>;
  putChunk(
    id: string,
    hash: string,
    index: number,
    data: string,
  ): Promise<void>;
  publish(manifest: Manifest): Promise<void>;
  list(): Promise<Manifest[]>;
};
export class SyncConflict extends Error {}
export async function upload(
  run: RunRecord,
  uid: string,
  remote: Transport,
  digest: Digest,
) {
  validateRuns([run]);
  const text = canonical(run);
  if (text.length > 50 * 1024 * 1024)
    throw new Error("Run payload exceeds 50MB limit");
  const hash = await digest(text),
    chunks: string[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    // Firestore encodes strings separately: never split a UTF-16 surrogate pair.
    if (
      end < text.length &&
      text.charCodeAt(end - 1) >= 0xd800 &&
      text.charCodeAt(end - 1) <= 0xdbff
    )
      end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  const chunkCount = chunks.length;
  const existing = await remote.getManifest(run.id);
  if (existing && (existing.hash !== hash || existing.ownerUid !== uid))
    throw new SyncConflict(
      "同一Run IDに異なるデータがあります。上書きしません",
    );
  if (existing) {
    await download(existing, uid, remote, digest);
    return existing;
  }
  for (let index = 0; index < chunkCount; index++)
    await remote.putChunk(run.id, hash, index, chunks[index]);
  const manifest: Manifest = {
    schemaVersion: 1,
    revision: 1,
    id: run.id,
    ownerUid: uid,
    hash,
    pointCount: run.points.length,
    chunkCount,
    complete: true,
  };
  // Publish last; incomplete uploads are never listed as completed runs.
  await remote.publish(manifest);
  await download(manifest, uid, remote, digest);
  return manifest;
}
export async function download(
  manifest: Manifest,
  uid: string,
  remote: Transport,
  digest: Digest,
): Promise<RunRecord> {
  if (
    typeof manifest.id !== 'string' || !manifest.id.trim() || manifest.id.length > 256 ||
    typeof manifest.hash !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.hash) ||
    manifest.ownerUid !== uid ||
    manifest.schemaVersion !== 1 ||
    manifest.revision !== 1 ||
    manifest.complete !== true ||
    !Number.isInteger(manifest.chunkCount) ||
    manifest.chunkCount < 1 ||
    manifest.chunkCount > 820 ||
    !Number.isInteger(manifest.pointCount) ||
    manifest.pointCount < 0
  )
    throw new Error("所有者・スキーマ・完了状態が不正です");
  const chunks: string[] = [];
  for (let i = 0; i < manifest.chunkCount; i++) {
    const chunk = await remote.getChunk(manifest.id, manifest.hash, i);
    if (typeof chunk !== "string" || chunk.length > CHUNK_SIZE)
      throw new Error("GPS payloadが欠損しています");
    chunks.push(chunk);
  }
  const text = chunks.join("");
  if ((await digest(text)) !== manifest.hash)
    throw new Error("SHA-256が一致しません");
  const run = JSON.parse(text);
  validateRuns([run]);
  if (run.id !== manifest.id || run.points.length !== manifest.pointCount)
    throw new Error("Run ID / GPS点数が一致しません");
  return run;
}
export type QueueEntry = {
  run: RunRecord;
  attempts: number;
  nextRetryAt: number;
  error: string | null;
  status: "pending" | "retrying" | "conflict" | "synced";
};
export type QueueStore = {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
};
// Adapted from TaskMemo DurableOutbox/SyncEngine: persist-before-send, ack-before-remove,
// owner-bound queue, exponential retry. Each state change commits before memory changes.
export class RunSyncQueue {
  private entries: QueueEntry[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    readonly uid: string,
    private store: QueueStore,
    private remote: Transport,
    private digest: Digest,
  ) {}
  get state() {
    return JSON.parse(JSON.stringify(this.entries)) as QueueEntry[];
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.serial.then(action);
    this.serial = next.catch(() => undefined);
    return next;
  }
  async open() {
    return this.exclusive(async () => {
      const raw = await this.store.load();
      if (raw) {
        const value = JSON.parse(raw);
        if (
          value.version !== 1 ||
          value.uid !== this.uid ||
          !Array.isArray(value.entries)
        )
          throw new Error("同期キューの所有者・形式が不正です");
        validateRuns(value.entries.map((entry: QueueEntry) => entry.run));
        this.entries = value.entries;
      }
    });
  }
  private async commit(entries: QueueEntry[]) {
    await this.store.save(canonical({ version: 1, uid: this.uid, entries }));
    this.entries = entries;
  }
  async enqueue(run: RunRecord) {
    return this.exclusive(async () => {
      validateRuns([run]);
      const prior = this.entries.find((e) => e.run.id === run.id);
      if (prior) {
        if (canonical(prior.run) !== canonical(run))
          throw new SyncConflict("ローカル同期キューのRun ID衝突");
        return;
      }
      const copy = JSON.parse(canonical(run)) as RunRecord;
      await this.commit([
        ...this.entries,
        {
          run: copy,
          attempts: 0,
          nextRetryAt: 0,
          error: null,
          status: "pending",
        },
      ]);
    });
  }
  async flush(now = Date.now(), retryNow = false) {
    return this.exclusive(async () => {
      for (const entry of [...this.entries]) {
        if (
          entry.status === "conflict" ||
          (!retryNow && entry.nextRetryAt > now)
        )
          continue;
        try {
          await upload(entry.run, this.uid, this.remote, this.digest);
          await this.commit(
            this.entries.filter((e) => e.run.id !== entry.run.id),
          );
        } catch (error) {
          const changed: QueueEntry = {
            ...entry,
            attempts: entry.attempts + 1,
            error: error instanceof Error ? error.message : String(error),
            nextRetryAt:
              now + Math.min(300000, 1000 * 2 ** Math.min(entry.attempts, 8)),
            status: error instanceof SyncConflict ? "conflict" : "retrying",
          };
          await this.commit(
            this.entries.map((e) => (e.run.id === entry.run.id ? changed : e)),
          );
        }
      }
      return this.state;
    });
  }
}
