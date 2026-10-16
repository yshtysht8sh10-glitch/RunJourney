import {
  Counts,
  hashText,
  iteratePages,
  PagedRunSource,
  RunPage,
  RunSummary,
  StreamKind,
  STREAMS,
  checkPage,
  validateSummary,
} from "../domain/pages";
import { canonical } from "../utils/run-backup-canonical";
import { SyncConflict, QueueStore } from "./protocol";
export type PageDescriptor = {
  kind: StreamKind;
  start: number;
  next: number;
  hash: string;
};
export type PageManifest = {
  schemaVersion: 2;
  revision: 1;
  summary: RunSummary;
  pages: PageDescriptor[];
};
export type PublishedRun = {
  schemaVersion: 2;
  revision: 1;
  ownerUid: string;
  id: string;
  hash: string;
  complete: true;
  summary: RunSummary;
};
export type PagedRemote = {
  get(id: string): Promise<PublishedRun | null>;
  list(): Promise<PublishedRun[]>;
  getBlob(hash: string): Promise<string | null>;
  putBlob(hash: string, data: string): Promise<void>;
  publish(header: PublishedRun): Promise<void>;
};
export async function prepareManifest(
  source: PagedRunSource,
): Promise<PageManifest> {
  const summary = await source.summary();
  validateSummary(summary);
  if (summary.error) throw new Error(summary.error);
  const pages: PageDescriptor[] = [];
  for (const kind of STREAMS) {
    for await (const page of iteratePages(source, kind)) {
      if (pages.length >= 4096)
        throw new Error(
          "ページ総数が4096を超えています。原本を保持して停止します",
        );
      pages.push({
        kind,
        start: page.start,
        next: page.next,
        hash: hashText(canonical(page)),
      });
    }
  }
  return { schemaVersion: 2, revision: 1, summary, pages };
}
export function validateManifest(manifest: PageManifest) {
  if (
    !manifest ||
    manifest.schemaVersion !== 2 ||
    manifest.revision !== 1 ||
    !Array.isArray(manifest.pages) ||
    manifest.pages.length > 4096
  )
    throw new Error("未対応のページmanifestです");
  validateSummary(manifest.summary);
  const positions = Object.fromEntries(STREAMS.map((k) => [k, 0])) as Counts;
  let lastKind = -1;
  for (const p of manifest.pages) {
    const kindIndex = STREAMS.indexOf(p.kind);
    if (
      kindIndex < lastKind ||
      kindIndex < 0 ||
      p.start !== positions[p.kind] ||
      !Number.isSafeInteger(p.next) ||
      p.next <= p.start ||
      p.next - p.start > 128 ||
      !/^[0-9a-f]{64}$/.test(p.hash)
    )
      throw new Error("manifestの順序・重複・欠損異常");
    positions[p.kind] = p.next;
    lastKind = kindIndex;
  }
  if (STREAMS.some((k) => positions[k] !== manifest.summary.counts[k]))
    throw new Error("manifestの点数・チャンク数不一致");
}
export async function uploadPaged(
  source: PagedRunSource,
  uid: string,
  remote: PagedRemote,
  prepared?: PageManifest,
) {
  const manifest = prepared ?? (await prepareManifest(source));
  validateManifest(manifest);
  const summary = await source.summary();
  if (canonical(summary) !== canonical(manifest.summary))
    throw new SyncConflict("キュー登録後にローカルのメタデータが変わりました");
  const text = canonical(manifest),
    hash = hashText(text),
    prior = await remote.get(summary.id);
  if (prior && (prior.hash !== hash || prior.ownerUid !== uid))
    throw new SyncConflict("同一Run IDの異なるページmanifestを上書きしません");
  // Every page is independently content-addressed. A retry skips intact uploaded
  // pages; no full RunRecord or giant JSON is held in the queue or bridge.
  for (const descriptor of manifest.pages) {
    const existing = await remote.getBlob(descriptor.hash);
    if (existing !== null) {
      if (hashText(existing) !== descriptor.hash)
        throw new Error(
          `クラウドページ破損: ${descriptor.kind}/${descriptor.start}`,
        );
      continue;
    }
    const page = await source.read(descriptor.kind, descriptor.start);
    checkPage(page, summary, descriptor.kind, descriptor.start);
    const payload = canonical(page);
    if (page.next !== descriptor.next || hashText(payload) !== descriptor.hash)
      throw new SyncConflict(
        "キュー登録後にローカルページが変わりました。原本を保持します",
      );
    await remote.putBlob(descriptor.hash, payload);
  }
  await remote.putBlob(hash, text);
  const header: PublishedRun = {
    schemaVersion: 2,
    revision: 1,
    ownerUid: uid,
    id: summary.id,
    hash,
    complete: true,
    summary,
  };
  await remote.publish(header);
  const receipt = await remote.get(summary.id);
  if (!receipt || canonical(receipt) !== canonical(header))
    throw new Error("公開受領が一致しません");
  return header;
}
export async function openPaged(
  header: PublishedRun,
  uid: string,
  remote: PagedRemote,
): Promise<PagedRunSource> {
  if (
    !header ||
    header.ownerUid !== uid ||
    header.schemaVersion !== 2 ||
    header.revision !== 1 ||
    !header.complete ||
    !/^[0-9a-f]{64}$/.test(header.hash)
  )
    throw new Error("所有者・完了状態・schema異常");
  const text = await remote.getBlob(header.hash);
  if (!text || text.length > 600000 || hashText(text) !== header.hash)
    throw new Error("manifest欠損・SHA-256異常");
  const manifest = JSON.parse(text) as PageManifest;
  validateManifest(manifest);
  if (
    canonical(manifest.summary) !== canonical(header.summary) ||
    header.id !== manifest.summary.id
  )
    throw new Error("メタデータとmanifestが一致しません");
  return {
    summary: async () => manifest.summary,
    read: async (kind, start) => {
      const descriptor = manifest.pages.find(
        (p) => p.kind === kind && p.start === start,
      );
      if (!descriptor) throw new Error(`未登録ページ: ${kind}/${start}`);
      const payload = await remote.getBlob(descriptor.hash);
      if (
        !payload ||
        payload.length > 65536 ||
        hashText(payload) !== descriptor.hash
      )
        throw new Error(`ページ欠損・SHA-256異常: ${kind}/${start}`);
      const page = JSON.parse(payload) as RunPage;
      checkPage(page, manifest.summary, kind, start);
      if (page.next !== descriptor.next) throw new Error("ページ境界不一致");
      return page;
    },
  };
}
export type PagedQueueEntry = {
  id: string;
  manifest: PageManifest;
  attempts: number;
  nextRetryAt: number;
  status: "pending" | "retrying" | "conflict";
  error: string | null;
};
export class PagedSyncQueue {
  private entries: PagedQueueEntry[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    readonly uid: string,
    private store: QueueStore,
    private source: (id: string) => PagedRunSource,
    private remote: PagedRemote,
  ) {}
  get state() {
    return this.entries.map((e) => ({
      id: e.id,
      attempts: e.attempts,
      nextRetryAt: e.nextRetryAt,
      status: e.status,
      error: e.error,
    }));
  }
  private exclusive<T>(work: () => Promise<T>) {
    const next = this.serial.then(work);
    this.serial = next.catch(() => undefined);
    return next;
  }
  private async commit(entries: PagedQueueEntry[]) {
    await this.store.save(canonical({ version: 2, uid: this.uid, entries }));
    this.entries = entries;
  }
  open() {
    return this.exclusive(async () => {
      const text = await this.store.load();
      if (!text) return;
      const v = JSON.parse(text);
      if (v.version !== 2 || v.uid !== this.uid || !Array.isArray(v.entries))
        throw new Error("同期キュー所有者・version不一致");
      v.entries.forEach((e: PagedQueueEntry) => {
        validateManifest(e.manifest);
        if (
          e.id !== e.manifest.summary.id ||
          !Number.isSafeInteger(e.attempts) ||
          e.attempts < 0 ||
          !Number.isFinite(e.nextRetryAt) ||
          !["pending", "retrying", "conflict"].includes(e.status)
        )
          throw new Error("同期キュー形式不正");
      });
      this.entries = v.entries;
    });
  }
  enqueue(id: string) {
    return this.exclusive(async () => {
      const manifest = await prepareManifest(this.source(id)),
        prior = this.entries.find((e) => e.id === id);
      if (prior) {
        if (canonical(prior.manifest) !== canonical(manifest))
          throw new SyncConflict("キュー内Run ID衝突");
        return;
      }
      await this.commit([
        ...this.entries,
        {
          id,
          manifest,
          attempts: 0,
          nextRetryAt: 0,
          status: "pending",
          error: null,
        },
      ]);
    });
  }
  flush(now = Date.now(), force = false) {
    return this.exclusive(async () => {
      for (const entry of [...this.entries]) {
        if (entry.status === "conflict" || (!force && entry.nextRetryAt > now))
          continue;
        try {
          await uploadPaged(
            this.source(entry.id),
            this.uid,
            this.remote,
            entry.manifest,
          );
          await this.commit(this.entries.filter((e) => e.id !== entry.id));
        } catch (e) {
          await this.commit(
            this.entries.map((item) =>
              item.id === entry.id
                ? {
                    ...entry,
                    attempts: entry.attempts + 1,
                    nextRetryAt:
                      now +
                      Math.min(300000, 1000 * 2 ** Math.min(entry.attempts, 8)),
                    status: e instanceof SyncConflict ? "conflict" : "retrying",
                    error: String(e),
                  }
                : item,
            ),
          );
        }
      }
      return this.state;
    });
  }
}
