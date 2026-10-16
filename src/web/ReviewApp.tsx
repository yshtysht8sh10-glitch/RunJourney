import { weeklyStreak, DEFAULT_WEEKLY_GOAL, validateWeeklyGoal, WeeklyGoal } from '../domain/weekly-streak';
import { useEffect, useMemo, useState } from "react";
import { Link, router, useLocalSearchParams } from "expo-router";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { RunRecord, LocationPoint } from "../types/run";
import {
  PagedRunSource,
  RunSummary,
  RunPage,
  sourceFromRun,
} from "../domain/pages";
import { BrowserPageCache, importPagedFile, seedCache } from "./paged-cache";
import PageInspector, { PageAnalysis } from "./PageInspector";
import {
  dailyDistances,
  dayKey,
  groupedDistances,
  journey,
  JOURNEY,
  runMetrics,
  shiftDay,
  statistics,
  streak,
} from "../domain/review";
import { demoRuns } from "./demo";
import RouteMap from "./RouteMap";
import { emulatorClient, firebasePagedTransport } from "../sync/firebase";
import { openPaged } from "../sync/paged-protocol";
import { calculateDistance } from "../utils/distance";
import "./review.css";

export async function browserDigest(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
const km = (m: number) =>
  (m / 1000).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const duration = (ms: number) =>
  `${Math.floor(ms / 3600000)}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const pace = (s: number | null) =>
  s === null
    ? "—"
    : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}/km`;
const localDate = (s: string, timeZone: string) =>
  new Date(s).toLocaleString("ja-JP", { timeZone });
function Metric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="metric">
      <small>{label}</small>
      <strong>
        {value}
        <em>{unit}</em>
      </strong>
    </div>
  );
}
function Chart({
  values,
  labels,
  label,
  onSelect,
  warningAbove,
}: {
  values: (number | undefined)[];
  labels?: string[];
  label: string;
  onSelect?: (i: number) => void;
  warningAbove?: number;
}) {
  const max = values.reduce<number>(
    (largest, v) =>
      v !== undefined && Number.isFinite(v) ? Math.max(largest, v) : largest,
    1,
  );
  // Bound SVG nodes for large GPS runs, keeping the maximum of each bucket and
  // its ORIGINAL source index so spikes remain inspectable on the map.
  const stride = Math.max(1, Math.ceil(values.length / 900));
  const samples: { index: number; value: number }[] = [];
  for (let start = 0; start < values.length; start += stride) {
    let index = -1,
      value = -Infinity;
    for (let i = start; i < Math.min(values.length, start + stride); i++) {
      const v = values[i];
      if (v !== undefined && Number.isFinite(v) && v > value) {
        index = i;
        value = v;
      }
    }
    if (index >= 0) samples.push({ index, value });
  }
  return (
    <div className="chart" role="img" aria-label={label}>
      <div className="chart-axis">
        {label} · 最大 {max.toFixed(1)}
        {stride > 1 ? ` · ${stride}点ごとの最大値（元インデックス保持）` : ""}
      </div>
      <svg viewBox="0 0 900 160" preserveAspectRatio="none">
        {samples.map(({ value: v, index: i }) => (
          <rect
            key={i}
            x={(i * 900) / Math.max(1, values.length)}
            y={150 - (v / max) * 130}
            width={Math.max(1, (900 * stride) / Math.max(1, values.length) - 2)}
            height={Math.max(1, (v / max) * 130)}
            rx="2"
            fill={
              warningAbove !== undefined && v > warningAbove
                ? "#f48b5f"
                : "currentColor"
            }
            onClick={() => onSelect?.(i)}
          >
            <title>
              {labels?.[i] ?? `#${i}`}: {v.toFixed(2)}
            </title>
          </rect>
        ))}
      </svg>
      <div className="chart-labels">
        <span>{labels?.[0] ?? "開始"}</span>
        <span>{labels?.at(-1) ?? "終了"}</span>
      </div>
    </div>
  );
}
type Toggles = { map: boolean; journey: boolean; streak: boolean };
type ReviewRow = RunSummary &
  Pick<RunRecord, "points" | "createdAt" | "updatedAt">;
const asRow = (summary: RunSummary): ReviewRow => ({
  ...summary,
  points: [],
  createdAt: "",
  updatedAt: "",
});
export default function ReviewApp() {
  const params = useLocalSearchParams<{ view?: string; run?: string }>();
  const view = typeof params.view === "string" ? params.view : "dashboard";
  useEffect(() => {
    document.title = `RunJourney · ${view}`;
  }, [view]);
  const [runs, setRuns] = useState<ReviewRow[]>([]),
    [source, setSource] = useState("未読込"),
    [diagnostic, setDiagnostic] = useState<Record<string, unknown> | null>(
      null,
    );
  const [cache, setCache] = useState<BrowserPageCache | null>(null);
  const [context, setContext] = useState<{
    open(id: string): Promise<PagedRunSource>;
  } | null>(null);
  const [gpsPage, setGpsPage] = useState<{ id: string; page: RunPage } | null>(
    null,
  );
  const [analysis, setAnalysis] = useState<{
    id: string;
    result: PageAnalysis;
  } | null>(null);
  const [progress, setProgress] = useState("");
  function localCache() {
    if (cache) return cache;
    const next = new BrowserPageCache();
    setCache(next);
    return next;
  }
  const [weeklyGoal, setWeeklyGoal] = useState<WeeklyGoal>(DEFAULT_WEEKLY_GOAL);
  useEffect(() => { const timer = setTimeout(() => { try { const saved = localStorage.getItem('runjourney-weekly-goal-v1'); if (saved) setWeeklyGoal(validateWeeklyGoal(JSON.parse(saved))); } catch { /* keep defaults */ } }, 0); return () => clearTimeout(timer); }, []);
  function updateWeeklyGoal(next: WeeklyGoal) { try { validateWeeklyGoal(next); localStorage.setItem('runjourney-weekly-goal-v1', JSON.stringify(next)); setWeeklyGoal(next); } catch { setError('週間目標を保存できませんでした'); } }
  const [period, setPeriod] = useState(30),
    [unit, setUnit] = useState<"day" | "week" | "month">("day"),
    [zone, setZone] = useState("Asia/Tokyo");
  const [flags, setFlags] = useState<Toggles>({
    map: false,
    journey: false,
    streak: false,
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0),
    [point, setPoint] = useState(0);
  const [user, setUser] = useState<User | null>(null),
    [connected, setConnected] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const today = dayKey(now, zone);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("runjourney-review-settings") ?? "{}",
        );
        setFlags({
          map: saved.map === true,
          journey: saved.journey === true,
          streak: saved.streak === true,
        });
      } catch {
        /* defaults */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!connected) return;
    return onAuthStateChanged(emulatorClient().auth, (next) => {
      setUser(next);
      if (!next) {
        setRuns([]);
        setSource("未読込");
      }
    });
  }, [connected]);
  function toggle(key: keyof Toggles) {
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    try {
      localStorage.setItem("runjourney-review-settings", JSON.stringify(next));
    } catch {
      setError("設定を保存できません。現在の画面には反映しました");
    }
  }
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const active = useMemo(
    () => runs.filter((r) => r.trashedAt === undefined),
    [runs],
  );
  const filtered = useMemo(
    () =>
      active.filter((run) => {
        const key = dayKey(run.startedAt, zone);
        return key <= today && (!period || key >= shiftDay(today, 1 - period));
      }),
    [active, zone, today, period],
  );
  const stats = useMemo(() => statistics(filtered), [filtered]),
    all = useMemo(() => statistics(active), [active]);
  const month = useMemo(
    () =>
      statistics(
        active.filter(
          (r) =>
            dayKey(r.startedAt, zone).slice(0, 7) === today.slice(0, 7) &&
            dayKey(r.startedAt, zone) <= today,
        ),
      ),
    [active, zone, today],
  );
  const trip = useMemo(() => journey(active), [active]),
    chain = useMemo(
      () => streak(active, { timeZone: zone, now, thresholdMeters: weeklyGoal.thresholdMeters }),
      [active, zone, now, weeklyGoal.thresholdMeters],
    );
  const weekly = useMemo(() => weeklyStreak(active, { now, timeZone: zone, goal: weeklyGoal }), [active, now, zone, weeklyGoal]);
  const groups = useMemo(
    () => groupedDistances(dailyDistances(filtered, zone), unit),
    [filtered, zone, unit],
  );
  const selectedMetadata = params.run
    ? runs.find((r) => r.id === params.run)
    : active[0];
  const selected = useMemo(
    () =>
      selectedMetadata
        ? {
            ...selectedMetadata,
            points:
              gpsPage?.id === selectedMetadata.id
                ? (gpsPage.page.items as LocationPoint[])
                : [],
          }
        : undefined,
    [selectedMetadata, gpsPage],
  );
  const range = useMemo(
    () => ({
      start: gpsPage?.id === selected?.id ? (gpsPage?.page.start ?? 0) : 0,
      total: selected?.pointCount ?? 0,
    }),
    [gpsPage, selected?.id, selected?.pointCount],
  );
  const metrics = useMemo(() => {
    if (!selected) return null;
    const result = runMetrics(selected);
    return analysis?.id === selected.id
      ? {
          ...result,
          laps: () => analysis.result.laps,
          intervals: analysis.result.intervals,
        }
      : result;
  }, [selected, analysis]);
  const nav = [
    { id: "dashboard", name: "Overview", sub: "ダッシュボード", icon: "◫" },
    { id: "history", name: "Your runs", sub: "走行履歴", icon: "↗" },
    ...(flags.journey
      ? [{ id: "journey", name: "Journey", sub: "月までの旅路", icon: "☾" }]
      : []),
    ...(flags.streak
      ? [{ id: "streak", name: "Streak", sub: "週間目標・継続", icon: "✦" }]
      : []),
    { id: "debugger", name: "Diagnostics", sub: "デバッガ", icon: "⌁" },
    { id: "settings", name: "Settings", sub: "設定・クラウド", icon: "⚙" },
  ];
  const history = (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {[
              "走行日 / Run ID",
              "終了日時",
              "総走行距離",
              "実走時間",
              "全経過時間",
              "平均ペース",
              "平均時速",
              "同期状態",
            ].map((s) => (
              <th key={s}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.slice(page * 50, page * 50 + 50).map((run) => {
            const m = runMetrics(run);
            return (
              <tr key={run.id}>
                <td>
                  <Link
                    href={{
                      pathname: "/",
                      params: { view: "detail", run: run.id },
                    }}
                  >
                    {localDate(run.startedAt, zone)}
                  </Link>
                  <small className="id">{run.id}</small>
                </td>
                <td>{localDate(run.endedAt, zone)}</td>
                <td className="accent">{km(m.distanceMeters)} km</td>
                <td>{duration(m.activeRunningTime)}</td>
                <td>{duration(m.wallClockElapsed)}</td>
                <td>{pace(m.pace.secondsPerKm)}</td>
                <td>{m.pace.kmPerHour?.toFixed(1) ?? "—"} km/h</td>
                <td>
                  <span className="pill">
                    {source === "Firebase Emulator"
                      ? "検証済み"
                      : "ローカルのみ"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!filtered.length && (
        <p className="empty">この期間の走行記録はありません。</p>
      )}
      {filtered.length > 50 && (
        <div className="toolbar">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            前へ
          </button>
          <span>
            {page + 1} / {Math.ceil(filtered.length / 50)}
          </span>
          <button
            disabled={(page + 1) * 50 >= filtered.length}
            onClick={() => setPage((p) => p + 1)}
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );
  return (
    <div className="review-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          run<span>journey</span>
          <i>↗</i>
        </Link>
        <div className="brand-note">EVERY RUN, A LITTLE FURTHER.</div>
        <nav>
          {nav.map((item) => (
            <Link
              key={item.id}
              href={{ pathname: "/", params: { view: item.id } }}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
            >
              <b>{item.icon}</b>
              <span>
                {item.name}
                <small>{item.sub}</small>
              </span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> {source}
          <small>
            REVIEW / ANALYZE
            <br />
            記録はNativeアプリで。
          </small>
        </div>
      </aside>
      <main className="review-main">
        <header>
          <div>
            <div className="eyebrow">YOUR RUNNING JOURNAL</div>
            <h1>
              {view === "detail"
                ? "Run detail"
                : (nav.find((n) => n.id === view)?.name ?? "Overview")}
              <span>走った記録を、もっと楽しもう。</span>
            </h1>
          </div>
          <div className="toolbar">
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const c = localCache();
                  setRuns(
                    (await seedCache(c, demoRuns().map(sourceFromRun))).map(
                      asRow,
                    ),
                  );
                  setContext({ open: (id) => c.source(id) });
                  setGpsPage(null);
                  setAnalysis(null);
                  setSource("サンプル（架空データ）");
                  setDiagnostic(null);
                  setPage(0);
                })
              }
            >
              サンプルを試す
            </button>
            <label className={`button primary ${busy ? "disabled" : ""}`}>
              JSON / NDJSONを読み込む
              <input
                type="file"
                accept=".json,.ndjson,.jsonl,application/json"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void action(async () => {
                      const c = localCache(),
                        importedDiagnostic = await importPagedFile(
                          file,
                          c,
                          setProgress,
                        );
                      if (!importedDiagnostic) {
                        setRuns((await c.list()).map((h) => asRow(h.summary)));
                        setContext({ open: (id) => c.source(id) });
                        setGpsPage(null);
                        setAnalysis(null);
                        setSource("ローカルファイル");
                        setPage(0);
                      }
                      setDiagnostic(importedDiagnostic);
                    });
                }}
              />
            </label>
          </div>
        </header>
        <div className="source-bar">
          <span className="status-dot" /> {source} · {runs.length}件（ごみ箱{" "}
          {runs.length - active.length}件）
          <span>
            集計はメタデータのみ · GPSは段階読込 · 取込はタブ専用IndexedDB内 ·
            原本は読取専用
          </span>
        </div>
        {busy && (
          <p role="status" className="notice">
            読み込み中…
          </p>
        )}
        {!!progress && <p role="status">{progress}</p>}
        {runs.some((r) => r.error) && (
          <p role="alert" className="error">
            一部走行の検証に失敗しています。履歴は消去せず、対象Runのエラーを表示します。
          </p>
        )}
        {["detail", "debugger"].includes(view) && selected && context && (
          <PageInspector
            key={`${source}:${selected.id}`}
            id={selected.id}
            context={context}
            showMap={flags.map}
            onGps={(id, page) => {
              setGpsPage({ id, page });
              setPoint(0);
            }}
            onAnalysis={(id, result) => setAnalysis({ id, result })}
          />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {["dashboard", "history"].includes(view) && (
          <div className="section-top">
            <h2>
              {view === "dashboard" ? "走った分だけ、前へ。" : "走行履歴"}
            </h2>
            <div className="segmented">
              {[7, 30, 90, 0].map((n) => (
                <button
                  key={n}
                  className={period === n ? "active" : ""}
                  onClick={() => {
                    setPeriod(n);
                    setPage(0);
                  }}
                >
                  {n ? `${n}日` : "全期間"}
                </button>
              ))}
            </div>
          </div>
        )}
        {view === "dashboard" && (
          <>
            <section className="hero">
              <div>
                <small>TOTAL DISTANCE</small>
                <div className="hero-number">
                  {km(all.distanceMeters)}
                  <span>km</span>
                </div>
                <p>積み重ねた距離が、あなたの旅になる。</p>
              </div>
              <div className="orbit">
                <span>☾</span>
                <i>●</i>
                <small>ONE STEP CLOSER</small>
              </div>
            </section>
            <div className="metrics-grid">
              <Metric
                label="今月の走行距離"
                value={km(month.distanceMeters)}
                unit="km"
              />
              <Metric label="今月の走行回数" value={month.count} unit="runs" />
              <Metric
                label="今月の実走時間"
                value={duration(month.activeRunningTime)}
              />
              <Metric
                label="選択期間の平均ペース"
                value={pace(stats.secondsPerKm)}
              />
              <Metric
                label="選択期間の平均時速"
                value={stats.kmPerHour?.toFixed(1) ?? "—"}
                unit="km/h"
              />
            </div>
            <section className="panel">
              <div className="section-top">
                <h2>
                  Distance over time{" "}
                  <small>選択期間 {km(stats.distanceMeters)} km</small>
                </h2>
                <select
                  aria-label="集計単位"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as typeof unit)}
                >
                  <option value="day">日別</option>
                  <option value="week">週別（月曜始まり）</option>
                  <option value="month">月別</option>
                </select>
              </div>
              <Chart
                label="走行距離 (km)"
                values={groups.map((g) => g.meters / 1000)}
                labels={groups.map((g) => g.day)}
              />
              {!groups.length && (
                <p className="empty">
                  JSONを読み込むか、架空のサンプルから始めましょう。
                </p>
              )}
            </section>
            <div className="two-col">
              {flags.journey && (
                <section className="panel">
                  <h2>☾ Journey</h2>
                  <p>現在地：{trip.current.name}</p>
                  <strong className="big">
                    {(trip.progress * 100).toFixed(2)}%
                  </strong>
                  <progress value={trip.progress} max="1" />
                  <p>
                    次の目的地 {trip.next?.name ?? "到達済み"} / あと実走{" "}
                    {trip.remainingKm.toFixed(1)} km
                  </p>
                </section>
              )}
              {flags.streak && (
                <section className="panel">
                  <h2>✦ 週間Streak</h2>
                  <strong className="big">
                    {weekly.current}
                    <small>週連続</small>
                  </strong>
                  <p>
                    今週 {weekly.count}/{weekly.goal.days}日 · {weekly.thisWeekAchieved ? '今週達成。残りの日は休養しても記録に不利益はありません。' : '今週は進行中です。休養を含めて無理のないペースで。'}
                  </p>
                  <p>最高記録 {weekly.best}週</p>
                </section>
              )}
            </div>
            <section className="panel">
              <div className="section-top">
                <h2>Recent runs</h2>
                <Link href={{ pathname: "/", params: { view: "history" } }}>
                  すべての履歴 ↗
                </Link>
              </div>
              {history}
            </section>
          </>
        )}
        {view === "history" && <section className="panel">{history}</section>}
        {view === "detail" &&
          (!selected || !metrics ? (
            <p className="empty">履歴を読み込んでください。</p>
          ) : (
            <>
              <Link href={{ pathname: "/", params: { view: "history" } }}>
                ← 履歴に戻る
              </Link>
              <section className="hero">
                <div>
                  <small>総走行距離 · EFFECTIVE RUN</small>
                  <div className="hero-number">
                    {km(metrics.distanceMeters)}
                    <span>km</span>
                  </div>
                  <p>
                    {localDate(selected.startedAt, zone)} →{" "}
                    {localDate(selected.endedAt, zone)}
                  </p>
                  <small>
                    保存距離 {km(selected.originalDistanceMeters)} km · Run ID{" "}
                    {selected.id}
                  </small>
                </div>
              </section>
              <div className="metrics-grid">
                <Metric
                  label="実走時間"
                  value={duration(metrics.activeRunningTime)}
                />
                <Metric
                  label="全経過時間"
                  value={duration(metrics.wallClockElapsed)}
                />
                <Metric
                  label="平均ペース"
                  value={pace(metrics.pace.secondsPerKm)}
                />
                <Metric
                  label="平均時速"
                  value={metrics.pace.kmPerHour?.toFixed(1) ?? "—"}
                  unit="km/h"
                />
                <Metric label="保存GPS点数" value={selected.pointCount} />
              </div>
              {flags.map && (
                <section className="panel">
                  <h2>GPS route</h2>
                  <RouteMap
                    run={selected}
                    selectedIndex={point}
                    pageRange={range}
                  />
                </section>
              )}
              <section className="panel">
                <h2>実走5分ラップ</h2>
                <Chart
                  label="ラップ距離 (km)"
                  values={metrics.laps().map((l) => l.distanceMeters / 1000)}
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ラップ</th>
                        <th>区間距離</th>
                        <th>実走時間</th>
                        <th>平均ペース</th>
                        <th>平均時速</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.laps().map((l, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{km(l.distanceMeters)} km</td>
                          <td>{duration(l.durationMs)}</td>
                          <td>{pace(l.secondsPerKm)}</td>
                          <td>{l.kmPerHour?.toFixed(1) ?? "—"} km/h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel">
                <h2>停止区間（原記録・読み取り専用）</h2>
                {metrics.intervals.length ? (
                  metrics.intervals.map((s) => (
                    <p key={s.id}>
                      {s.kind} ·{" "}
                      {new Date(s.startMs).toLocaleTimeString("ja-JP", {
                        timeZone: zone,
                      })}{" "}
                      · {duration(s.durationMs)} ·{" "}
                      {s.included ? "走行に含む補正あり" : "除外"}
                    </p>
                  ))
                ) : (
                  <p>
                    未解析です。段階解析ボタンで停止イベント・5分ラップを読み込めます。
                  </p>
                )}
                <p>履歴補正・Apply / Undoは今回のWeb版では未実装です。</p>
              </section>
            </>
          ))}
        {view === "journey" &&
          (flags.journey ? (
            <>
              <section className="hero journey-hero">
                <div>
                  <small>FROM SHIZUOKA TO THE MOON</small>
                  <h2>走った距離が、旅になる。</h2>
                  <p>
                    実走 {trip.actualKm.toFixed(2)} km → Journey換算{" "}
                    {trip.traveledKm.toFixed(0)} km
                  </p>
                  <div className="hero-number">
                    {(trip.progress * 100).toFixed(2)}
                    <span>%</span>
                  </div>
                </div>
                <div className="moon">☾</div>
              </section>
              <section className="panel">
                <h2>あなたのロードマップ</h2>
                <div className="roadmap">
                  {JOURNEY.milestones.map((m) => (
                    <div
                      key={m.name}
                      className={
                        trip.traveledKm >= m.kilometers ? "reached" : ""
                      }
                    >
                      <b>{m.icon}</b>
                      <h3>{m.name}</h3>
                      <p>Journey {m.kilometers.toLocaleString()} km</p>
                      <small>
                        {trip.traveledKm >= m.kilometers
                          ? "到達済み"
                          : "これからの目的地"}
                      </small>
                    </div>
                  ))}
                </div>
                <progress value={trip.progress} max="1" />
                <p>
                  現在地：{trip.current.name}から
                  {trip.next?.name ?? "最終目的地"}へ。次の目的地まで実走{" "}
                  {trip.remainingKm.toFixed(2)} km。
                </p>
                <small>
                  実走距離 × {JOURNEY.multiplier}{" "}
                  のゲーム用スケール。中間地点は演出用で、実際の地理経路・距離を示しません。月は平均距離384,400kmを基準にしています。
                </small>
              </section>
            </>
          ) : (
            <p>設定でJourneyをONにしてください。</p>
          ))}
        {view === "streak" &&
          (flags.streak ? (
            <>
              <section className="hero">
                <div>
                  <small>RUN AT YOUR OWN PACE</small>
                  <div className="hero-number">{weekly.current}<span>週連続達成</span></div>
                  <p>今週 {weekly.count}/{weekly.goal.days}日 · {weekly.thisWeekAchieved ? '今週達成' : '今週は進行中'}</p>
                  <p>休養を含めて、長く続ける。痛みや疲労がある日は休養を優先してください。</p>
                </div>
                <div className="streak-star">✦</div>
              </section>
              <div className="two-col">
                <section className="panel">
                  <h2>週間目標の達成カレンダー</h2>
                  <p>✓ 達成走行日 / ○ 走行記録あり・条件未達 / · 未記録 / — これからの日。休養登録は未実装のため、未記録を休養と断定しません。</p>
                  <div className="calendar">{weekly.calendar.map(d => <div key={d.day} className={d.state === 'achieved' ? 'achieved' : ''} title={`${d.day}: ${km(d.meters)} km / ${d.minutes.toFixed(1)}分`}><small>{d.day.slice(5)}</small><b>{d.state === 'achieved' ? '✓' : d.state === 'recorded' ? '○' : d.state === 'future' ? '—' : '·'}</b></div>)}</div>
                </section>
                <section className="panel">
                  <Metric label="過去最高週間Streak" value={weekly.best} unit="週" />
                  <p>今週 {weekly.count}/{weekly.goal.days}日。進行中の週が未達でも、前週までの週間Streakを保持し、週終了時に確定します。</p>
                  <p>同日のEffective走行を合算し、{weekly.goal.thresholdMeters / 1000}km以上{weekly.goal.thresholdMinutes > 0 ? `かつ実走${weekly.goal.thresholdMinutes}分以上` : ''}で1走行日。{zone}・{['日','月','火','水','木','金','土'][weekly.goal.weekStartsOn]}曜始まり。日跨ぎは開始日へ計上、ごみ箱は除外します。</p>
                  <p>設定変更は過去の全履歴を現在の条件で再評価します。</p>
                  <details><summary>参考：日次Streak（距離基準）</summary><p>現在 {chain.current}日 / 過去最高 {chain.best}日。日次記録を維持するために走る必要はありません。</p></details>
                </section>
              </div>
            </>
          ) : (
            <p>設定でStreakをONにしてください。</p>
          ))}
        {view === "debugger" && (
          <>
            <section className="panel">
              <h2>Run diagnostics</h2>
              <select
                aria-label="診断対象Run"
                value={selected?.id ?? ""}
                onChange={(e) => {
                  router.replace({
                    pathname: "/",
                    params: { view: "debugger", run: e.target.value },
                  });
                }}
              >
                <option value="">Runを選択</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
              </select>
              <p>
                診断JSONは原記録の観測情報だけを表示します。保存GPSから停止理由や音声再生を推測しません。
              </p>
              {selected && (
                <>
                  <div className="metrics-grid">
                    <Metric label="Run ID" value={selected.id} />
                    <Metric label="GPS点数" value={selected.pointCount} />
                    <Metric
                      label="buildHash（Run記録内）"
                      value={String(
                        (selected as RunRecord & { buildHash?: string })
                          .buildHash ?? "データなし",
                      )}
                    />
                    <Metric
                      label="schemaVersion（Run記録内）"
                      value={String(
                        (selected as RunRecord & { schemaVersion?: number })
                          .schemaVersion ?? "データなし",
                      )}
                    />
                  </div>
                  <p>
                    同期状態：
                    {source === "Firebase Emulator"
                      ? "SHA-256・GPS点数検証済み / schemaVersion 1"
                      : "ローカルのみ / 同期エラー記録なし"}
                  </p>
                  <label>
                    ページ内GPS点インデックス{" "}
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, selected.points.length - 1)}
                      value={point}
                      onChange={(e) =>
                        setPoint(
                          Math.min(
                            Math.max(0, Number(e.target.value)),
                            Math.max(0, selected.points.length - 1),
                          ),
                        )
                      }
                    />
                  </label>
                  <pre>
                    {JSON.stringify(
                      selected.points[point] ?? "データなし",
                      null,
                      2,
                    )}
                  </pre>
                  <Chart
                    label="保存GPS速度 (m/s)"
                    warningAbove={12.5}
                    values={selected.points.map((p) =>
                      p.speed !== undefined && p.speed >= 0
                        ? p.speed
                        : undefined,
                    )}
                    onSelect={setPoint}
                  />
                  <Chart
                    label="GPS accuracy (m)"
                    warningAbove={50}
                    values={selected.points.map((p) =>
                      p.accuracy !== undefined && p.accuracy >= 0
                        ? p.accuracy
                        : undefined,
                    )}
                    onSelect={setPoint}
                  />
                  <Chart
                    label="保存点の観測間隔 (秒) · 高頻度Observationとは別"
                    warningAbove={15}
                    values={selected.points.map((p, i) =>
                      i
                        ? (p.timestamp - selected.points[i - 1].timestamp) /
                          1000
                        : undefined,
                    )}
                    onSelect={setPoint}
                  />
                  <Chart
                    label="GPS点間から算出した累計距離 (km) · 停止補正なし"
                    values={(() => {
                      let total = 0;
                      return selected.points.map((p, i) => {
                        if (i)
                          total += calculateDistance([
                            selected.points[i - 1],
                            p,
                          ]);
                        return total / 1000;
                      });
                    })()}
                    onSelect={setPoint}
                  />
                  {flags.map && (
                    <RouteMap
                      run={selected}
                      selectedIndex={point}
                      pageRange={range}
                    />
                  )}
                  <h3>保存イベント / 停止候補・取消・確定</h3>
                  <pre>
                    {JSON.stringify(
                      {
                        events:
                          "eventsページを明示読み込みしてください（未読込）",
                        diagnostics:
                          "diagnosticsページを明示読み込みしてください（未読込）",
                      },
                      null,
                      2,
                    )}
                  </pre>
                </>
              )}
            </section>
            {diagnostic && (
              <section className="panel">
                <h2>取り込んだ診断JSON（GPS座標なしの場合、地図生成不可）</h2>
                <pre>{JSON.stringify(diagnostic, null, 2).slice(0, 64000)}</pre>
              </section>
            )}
            {!selected && !diagnostic && (
              <p className="empty">
                RunRecordまたはAuto Stop診断JSONを読み込んでください。
              </p>
            )}
          </>
        )}
        {view === "settings" && (
          <>
            <section className="panel">
              <h2>表示機能</h2>
              {(["map", "journey", "streak"] as const).map((key) => (
                <label className="setting" key={key}>
                  <span>
                    {key === "map"
                      ? "GPS地図"
                      : key === "journey"
                        ? "Journey（月までの旅路）"
                        : "Streak（週間目標・継続）"}
                  </span>
                  <input
                    type="checkbox"
                    checked={flags[key]}
                    onChange={() => toggle(key)}
                  />
                </label>
              ))}
              <label className="setting">
                日付・集計タイムゾーン
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option>Asia/Tokyo</option>
                  <option>UTC</option>
                  <option>America/Los_Angeles</option>
                  <option>Europe/London</option>
                </select>
              </label>
              <label className="setting">週間目標の走行日数<select aria-label="週間目標の走行日数" value={weeklyGoal.days} onChange={e => updateWeeklyGoal({ ...weeklyGoal, days: Number(e.target.value) })}>{[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>週{n}日</option>)}</select></label>
              <label className="setting">週の開始曜日<select aria-label="週の開始曜日" value={weeklyGoal.weekStartsOn} onChange={e => updateWeeklyGoal({ ...weeklyGoal, weekStartsOn: Number(e.target.value) })}>{['日','月','火','水','木','金','土'].map((d,n) => <option key={n} value={n}>{d}曜日</option>)}</select></label>
              <label className="setting">1日の最低合計距離<select aria-label="1日の最低合計距離" value={weeklyGoal.thresholdMeters} onChange={e => updateWeeklyGoal({ ...weeklyGoal, thresholdMeters: Number(e.target.value) })}>{[500,1000,2000,3000,5000].map(n => <option key={n} value={n}>{n/1000}km</option>)}</select></label>
              <label className="setting">1日の最低実走時間<select aria-label="1日の最低実走時間" value={weeklyGoal.thresholdMinutes} onChange={e => updateWeeklyGoal({ ...weeklyGoal, thresholdMinutes: Number(e.target.value) })}>{[0,5,10,20,30].map(n => <option key={n} value={n}>{n ? n+'分（距離条件も必要）' : '追加条件なし'}</option>)}</select></label>
              <p>週間目標の変更は過去の全履歴を再評価します。設定はこのブラウザ内だけに保存し、RunRecordと分離します。</p>
              <p>
                機能は初期状態OFF。表示設定をブラウザに保存します。取り込んだ記録は下記のタブ専用IndexedDBに保管します。
              </p>
            </section>
            <section className="panel">
              <h2>Firebase Emulator · 認証とクラウド閲覧</h2>
              <p>
                ローカル専用 demo-runjourney / Auth :9099 / Firestore
                :8080。本番Firebaseへの接続は無効です。
              </p>
              {!connected ? (
                <button
                  onClick={() => {
                    emulatorClient();
                    setConnected(true);
                  }}
                >
                  Emulatorに接続
                </button>
              ) : !user ? (
                <form
                  className="auth-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await signInWithEmailAndPassword(
                        emulatorClient().auth,
                        email,
                        password,
                      );
                    });
                  }}
                >
                  <input
                    type="email"
                    aria-label="メールアドレス"
                    placeholder="demo@example.test"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  <input
                    type="password"
                    aria-label="パスワード"
                    placeholder="パスワード（6文字以上）"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button disabled={busy}>ログイン</button>
                  <button
                    type="button"
                    disabled={busy || !email || password.length < 6}
                    onClick={() =>
                      void action(async () => {
                        await createUserWithEmailAndPassword(
                          emulatorClient().auth,
                          email,
                          password,
                        );
                      })
                    }
                  >
                    テストアカウント作成
                  </button>
                </form>
              ) : (
                <>
                  <p>ログイン中：{user.email}</p>
                  <div className="toolbar">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const expected = user.uid,
                            client = emulatorClient(),
                            remote = firebasePagedTransport(client, expected),
                            manifests = await remote.list();
                          if (client.auth.currentUser?.uid !== expected)
                            throw new Error("アカウントが変更されました");
                          setRuns(manifests.map((m) => asRow(m.summary)));
                          setContext({
                            open: async (id) => {
                              const header = manifests.find((m) => m.id === id);
                              if (!header)
                                throw new Error("走行manifestが見つかりません");
                              return openPaged(header, expected, remote);
                            },
                          });
                          setGpsPage(null);
                          setAnalysis(null);
                          setProgress(
                            `${manifests.length}件のメタデータ取得。GPSのダウンロードは0ページです`,
                          );
                          setSource("Firebase Emulator");
                          setPage(0);
                        })
                      }
                    >
                      クラウド履歴を読み込む（GPSなし）
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await signOut(emulatorClient().auth);
                          setRuns([]);
                          setSource("未読込");
                        })
                      }
                    >
                      ログアウト
                    </button>
                  </div>
                </>
              )}
              <p>
                Webは閲覧専用。Nativeからの送信は専用のCloud
                Sync画面でプレビュー後に実行します。
              </p>
            </section>
            <section className="panel">
              <h2>ローカルデータ</h2>
              <p>
                大容量は分割NDJSON/JSONL（512MiBまで）を使用してください。旧JSONの一括解析は5MiBまでです。タブ専用のIndexedDBに保存し、原ファイルの変更・クラウド送信は行いません。タブ終了後も一時DBが残る場合があるため、不要になったら下のボタンで消去してください。
              </p>
              <p>
                対応：バックアップJSON v1 / SQLiteバックアップ
                v2（SHA-256検証）/ 単体RunRecord / 配列 / Auto Stop診断 schema
                2。
              </p>
              <button
                onClick={() =>
                  void action(async () => {
                    if (cache) await cache.dispose();
                    setCache(null);
                    setContext(null);
                    setGpsPage(null);
                    setAnalysis(null);
                    setRuns([]);
                    setDiagnostic(null);
                    setSource("未読込");
                  })
                }
              >
                ブラウザ内の一時データを閉じて消去
              </button>
            </section>
          </>
        )}
        <footer>
          RUNJOURNEY · 走るときは、確実に。走ったあとは、思う存分。
          <span>READ ONLY WORKSPACE</span>
        </footer>
      </main>
    </div>
  );
}
