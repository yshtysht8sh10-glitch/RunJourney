import {
  hashText,
  PagedRunSource,
  STREAMS,
  sourceFromRun,
} from "../domain/pages";
import { canonical } from "../utils/run-backup-canonical";
import {
  PageManifest,
  PublishedRun,
  PagedRemote,
  prepareManifest,
  openPaged,
  uploadPaged,
  validateManifest,
} from "../sync/paged-protocol";
import { parseReviewFile } from "../domain/review";

// A tab-specific local IndexedDB, never a cloud cache. React keeps metadata and
// at most one GPS page. Original files are never modified or uploaded.
export class BrowserPageCache implements PagedRemote {
  private opening: Promise<IDBDatabase>;
  readonly name = `runjourney-review-${crypto.randomUUID()}`;
  constructor() {
    this.opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("runs");
        request.result.createObjectStore("blobs");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  private async getValue<T>(store: string, key: string): Promise<T | null> {
    const db = await this.opening;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly"),
        req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  private async put(store: string, key: string, value: unknown) {
    const db = await this.opening;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }
  get(id: string) {
    return this.getValue<PublishedRun>("runs", id);
  }
  getBlob(hash: string) {
    return this.getValue<string>("blobs", hash);
  }
  async putBlob(hash: string, data: string) {
    if (hashText(data) !== hash) throw new Error("ローカルページhash不一致");
    const prior = await this.getBlob(hash);
    if (prior !== null && prior !== data) throw new Error("ローカルページ衝突");
    if (prior === null) await this.put("blobs", hash, data);
  }
  async publish(header: PublishedRun) {
    const prior = await this.get(header.id);
    if (prior && prior.hash !== header.hash)
      throw new Error("ローカルRun ID衝突");
    await this.put("runs", header.id, header);
  }
  async list(): Promise<PublishedRun[]> {
    const db = await this.opening;
    return new Promise((resolve, reject) => {
      const req = db
        .transaction("runs", "readonly")
        .objectStore("runs")
        .getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async add(source: PagedRunSource) {
    return uploadPaged(source, "local-file", this);
  }
  async source(id: string) {
    const header = await this.get(id);
    if (!header) throw new Error("ローカル走行が見つかりません");
    return openPaged(header, "local-file", this);
  }
  async dispose() {
    const db = await this.opening;
    db.close();
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("一時DBが使用中です"));
    });
  }
}
export async function importPagedFile(
  file: File,
  cache: BrowserPageCache,
  onProgress: (message: string) => void,
) {
  if (file.size > 512 * 1024 * 1024)
    throw new Error("分割ファイル上限は512MiBです");
  if (!file.name.endsWith(".ndjson") && !file.name.endsWith(".jsonl")) {
    if (file.size > 5 * 1024 * 1024)
      throw new Error(
        "従来JSONの一括解析上限は5MiBです。大きい記録にはページ形式NDJSONを使用してください",
      );
    const result = await parseReviewFile(await file.text(), async (text) =>
      hashText(text),
    );
    if (result.runs) {
      for (const run of result.runs) await cache.add(sourceFromRun(run));
    }
    return result.diagnostic;
  }
  const reader = file.stream().getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    first = true,
    pending: PageManifest | null = null,
    position = 0,
    runCount = 0,
    lineCount = 0;
  async function line(text: string) {
    if (!text.trim()) return;
    if (text.length > 700000) throw new Error("NDJSONの単一行が大きすぎます");
    const value = JSON.parse(text);
    lineCount++;
    if (first) {
      first = false;
      if (value.format !== "runjourney-paged" || value.schemaVersion !== 2)
        throw new Error("未対応のページファイル形式");
      return;
    }
    if (value.type === "run") {
      if (pending) throw new Error("未完了Runの途中に別Runがあります");
      validateManifest(value.manifest);
      pending = value.manifest;
      position = 0;
    } else if (value.type === "page") {
      if (!pending || value.runId !== pending.summary.id)
        throw new Error("Run ID・ページ順序異常");
      const descriptor = pending.pages[position++],
        data = canonical(value.page);
      if (
        !descriptor ||
        hashText(data) !== descriptor.hash ||
        value.hash !== descriptor.hash ||
        value.page.kind !== descriptor.kind ||
        value.page.start !== descriptor.start ||
        value.page.next !== descriptor.next
      )
        throw new Error("ファイルページ欠損・重複・順序・hash不一致");
      // Check the same bounded page contract used by cloud reads.
      const { checkPage } = await import("../domain/pages");
      checkPage(value.page, pending.summary, descriptor.kind, descriptor.start);
      await cache.putBlob(descriptor.hash, data);
    } else if (value.type === "end-run") {
      if (
        !pending ||
        value.runId !== pending.summary.id ||
        position !== pending.pages.length ||
        value.hash !== hashText(canonical(pending))
      )
        throw new Error("不完全なRunファイルです");
      const hash = value.hash;
      await cache.putBlob(hash, canonical(pending));
      await cache.publish({
        schemaVersion: 2,
        revision: 1,
        id: pending.summary.id,
        ownerUid: "local-file",
        hash,
        complete: true,
        summary: pending.summary,
      });
      pending = null;
      runCount++;
      if (runCount > 10000)
        throw new Error("ファイル内Run数上限を超えています");
    } else throw new Error("未対応のNDJSONレコード");
    if (lineCount % 16 === 0) {
      onProgress(`${runCount}走行 / ${lineCount}行を検証中`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const current = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        await line(current);
      }
      if (buffer.length > 700000)
        throw new Error("NDJSON単一行上限を超えています");
      if (done) break;
    }
    if (buffer) await line(buffer);
    if (first || pending) throw new Error("空ファイルまたは未完了ファイルです");
    onProgress(`${runCount}走行の検証完了`);
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function seedCache(
  cache: BrowserPageCache,
  sources: PagedRunSource[],
) {
  for (const source of sources) await cache.add(source);
  return (await cache.list()).map((h) => h.summary);
}
export { STREAMS, prepareManifest };
