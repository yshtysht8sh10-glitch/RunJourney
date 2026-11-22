import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { RunRepository } from "../repositories/run-repository";
import { RunPage, RunSummary, StreamKind, STREAMS } from "../domain/pages";
import { exportPagedRun } from "../services/paged-export";
import { pagedLapAnalysis } from "../domain/paged-analysis";
import { analyzePace } from "../utils/pace-analysis";
import PaceWorkoutReport from './pace-workout-report';
export default function NativeRunPages({ summary }: { summary: RunSummary }) {
  const [page, setPage] = useState<RunPage | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const source = RunRepository.pagedSource(summary.id);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(
        `読み出しに失敗しました。原本は保持されています: ${String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function load(kind: StreamKind, start = 0) {
    setPage(await source.read(kind, start));
  }
  const button = (label: string, handler: () => void) => (
    <Pressable disabled={busy} style={styles.button} onPress={handler}>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>長時間走行のページ詳細</Text>
      <PaceWorkoutReport key={summary.id} runId={summary.id} lazy />
      <Text style={styles.distance}>
        {(summary.distanceMeters / 1000).toFixed(2)} km
      </Text>
      <Text style={styles.text}>
        {summary.startedAt} → {summary.endedAt}
      </Text>
      <Text style={styles.text}>
        実走 {Math.floor(summary.activeRunningTime / 60000)}分 / 全経過{" "}
        {Math.floor(summary.wallClockElapsed / 60000)}分 / 平均時速{" "}
        {analyzePace(
          0,
          summary.activeRunningTime,
          summary.distanceMeters,
        ).kmPerHour?.toFixed(2) ?? "—"}{" "}
        km/h
      </Text>
      <Text style={styles.text}>
        GPS {summary.pointCount}点。1ページ最大128行 /
        64KiB。原GPSを書き換えません。
      </Text>
      {STREAMS.map((kind) => (
        <Pressable
          testID={`page-${kind}`}
          key={kind}
          disabled={busy || !summary.counts[kind]}
          style={styles.button}
          onPress={() => void work(() => load(kind))}
        >
          <Text style={styles.text}>
            {kind} 先頭ページ（{summary.counts[kind]}行）
          </Text>
        </Pressable>
      ))}
      {page && (
        <>
          <Text style={styles.text}>
            {page.kind} #{page.start}–{page.next - 1}
          </Text>
          {page.next < summary.counts[page.kind] &&
            button(
              "次のページ",
              () => void work(() => load(page.kind, page.next)),
            )}
          <Text style={styles.raw} selectable>
            {JSON.stringify(page.items, null, 2)}
          </Text>
        </>
      )}
      {button(
        "5分ラップを段階解析",
        () =>
          void work(async () => {
            const result = await pagedLapAnalysis(source);
            setMessage(
              result.laps
                .map(
                  (l, i) =>
                    `${i + 1}: ${(l.distanceMeters / 1000).toFixed(2)} km / ${(l.durationMs / 60000).toFixed(1)}分`,
                )
                .join("\n"),
            );
          }),
      )}
      {button(
        "分割NDJSONをExport（GPS座標を含む）",
        () => void work(() => exportPagedRun(summary.id)),
      )}
      <Text style={styles.text}>
        大容量記録の補正・削除はこの画面では提供しません。地図の全体確認にはWebの段階読み込みを使用してください。
      </Text>
      {busy && <Text style={styles.text}>処理中…</Text>}
      {!!message && <Text style={styles.text}>{message}</Text>}
      {button("履歴へ戻る", () => router.replace("/history"))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { padding: 24, paddingTop: 60, gap: 16, backgroundColor: "#111418" },
  title: { fontSize: 24, color: "#fff" },
  distance: { fontSize: 44, color: "#E8A975" },
  text: { color: "#d1dcd5", lineHeight: 24 },
  button: { padding: 16, borderRadius: 8, backgroundColor: "#304d3c" },
  raw: { fontSize: 11, color: "#bed3c2", lineHeight: 18 },
});
