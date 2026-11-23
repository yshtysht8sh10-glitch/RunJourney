import { useEffect, useMemo, useState } from "react";
import {
  PagedRunSource,
  RunPage,
  RunSummary,
  StreamKind,
  STREAMS,
  iteratePages,
} from "../domain/pages";
import { pagedLapAnalysis } from "../domain/paged-analysis";
import type { LocationPoint } from "../types/run";
import RouteMap from "./RouteMap";
export type PageAnalysis = Awaited<ReturnType<typeof pagedLapAnalysis>>;
export default function PageInspector({
  id,
  context,
  showMap,
  onGps,
  onAnalysis,
}: {
  id: string;
  context: { open(id: string): Promise<PagedRunSource> };
  showMap: boolean;
  onGps(id: string, page: RunPage): void;
  onAnalysis(id: string, result: PageAnalysis): void;
}) {
  const [opened, setOpened] = useState<{
    source: PagedRunSource;
    summary: RunSummary;
  } | null>(null);
  const [page, setPage] = useState<RunPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [overview, setOverview] = useState<LocationPoint[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void context
      .open(id)
      .then(async (source) => ({ source, summary: await source.summary() }))
      .then((value) => {
        if (!cancelled) {
          setOpened(value);
          setPage(null);
          setOverview(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id, context]);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setProgress("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function load(kind: StreamKind, start = 0) {
    if (!opened) return;
    const next = await opened.source.read(kind, start);
    setPage(next);
    if (kind === "gps") {
      onGps(id, next);
      setOverview(null);
    }
  }
  const mapRun = useMemo(() => ({ points: overview ?? [] }), [overview]);
  const range = useMemo(
    () => ({
      start: 0,
      total: opened?.summary.pointCount ?? 0,
      overview: true,
    }),
    [opened?.summary.pointCount],
  );
  return (
    <section className="panel">
      <h2>段階読み込み · 最大128行 / 64KiB</h2>
      <p>
        一覧・Journey・Streak・月間集計はメタデータだけを使用しています。GPS・診断は明示操作後に1ページずつ読みます。
      </p>
      {error && (
        <p role="alert" className="error">
          {error} · 原本は保持されています。他のRunは引き続き閲覧できます。
        </p>
      )}
      {busy && <p role="status">処理中… {progress}</p>}
      {opened && (
        <>
          <div className="toolbar">
            {STREAMS.map((kind) => (
              <button
                key={kind}
                disabled={busy || !opened.summary.counts[kind]}
                onClick={() => void work(() => load(kind))}
              >
                {kind} 先頭ページ（{opened.summary.counts[kind]}行）
              </button>
            ))}
          </div>
          {page && (
            <>
              <p>
                {page.kind} 元データ行 #{page.start}–{page.next - 1} /{" "}
                {opened.summary.counts[page.kind]}（保持は1ページ）
              </p>
              <button
                disabled={busy || page.next >= opened.summary.counts[page.kind]}
                onClick={() => void work(() => load(page.kind, page.next))}
              >
                次のページ
              </button>
              {page.kind !== "gps" && (
                <pre>{JSON.stringify(page.items, null, 2)}</pre>
              )}
            </>
          )}
          <div className="toolbar">
            <button
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  const result = await pagedLapAnalysis(opened.source, (n) =>
                    setProgress(
                      `ラップ解析 ${n}/${opened.summary.pointCount}点`,
                    ),
                  );
                  onAnalysis(id, result);
                })
              }
            >
              5分ラップ・停止区間を段階解析
            </button>
            {showMap && (
              <button
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    const points: LocationPoint[] = [],
                      stride = Math.max(
                        1,
                        Math.ceil(opened.summary.pointCount / 1500),
                      );
                    let last: LocationPoint | undefined;
                    for await (const p of iteratePages(opened.source, "gps")) {
                      (p.items as LocationPoint[]).forEach((fix, i) => {
                        if ((p.start + i) % stride === 0) points.push(fix);
                        last = fix;
                      });
                      setProgress(
                        `地図概要 ${p.next}/${opened.summary.pointCount}点`,
                      );
                      await new Promise((resolve) => setTimeout(resolve, 0));
                    }
                    if (last && points.at(-1) !== last) points.push(last);
                    setOverview(points);
                  })
                }
              >
                全軌跡の概要を段階読み込み
              </button>
            )}
          </div>
        </>
      )}
      {overview && (
        <>
          <p>
            保存点だけから抽出した概要 {overview.length}点 / 元
            {opened?.summary.pointCount}
            点。完全なGPSはページ表示で確認できます。
          </p>
          <RouteMap run={mapRun} pageRange={range} />
        </>
      )}
    </section>
  );
}
