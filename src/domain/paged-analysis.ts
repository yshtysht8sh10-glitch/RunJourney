import { PagedRunSource, iteratePages } from "./pages";
import { ActiveRun, LocationPoint, RunEvent } from "../types/run";
import { effectiveRun, stopIntervals } from "../utils/run-model";
import { analyzePace, timeLapRanges } from "../utils/pace-analysis";
export async function pagedLapAnalysis(
  source: PagedRunSource,
  progress?: (points: number) => void,
) {
  const summary = await source.summary();
  async function text(kind: "metadata" | "operations") {
    let result = "";
    for await (const page of iteratePages(source, kind)) {
      result += page.items.join("");
      if (result.length > 128 * 1024)
        throw new Error(
          "制御メタデータが128KiBを超えるためラップ解析は保留します",
        );
    }
    return result ? JSON.parse(result) : {};
  }
  const metadata = await text("metadata"),
    operations = await text("operations"),
    events: RunEvent[] = [];
  for await (const page of iteratePages(source, "events")) {
    if (events.length + page.items.length > 2048)
      throw new Error("イベント2048件超のラップ解析は保留します");
    events.push(...(page.items as RunEvent[]));
  }
  if (
    Object.values(operations.stopOverrides ?? {}).some(
      (v) => (v as { included: boolean }).included,
    )
  )
    throw new Error(
      "走行に含めた停止補正のページ解析は未対応です。総距離・時間は保存メタデータを表示します",
    );
  const control = {
    ...metadata,
    ...operations,
    id: summary.id,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    events,
    points: [],
    distanceMeters: summary.originalDistanceMeters,
  } as ActiveRun;
  const ranges = timeLapRanges(summary.activeRunningTime),
    distances = ranges.map(() => 0);
  let previous: LocationPoint | undefined;
  for await (const page of iteratePages(source, "gps")) {
    const points = page.items as LocationPoint[],
      chunk = { ...control, points: previous ? [previous, ...points] : points };
    const effective = effectiveRun(chunk, Date.parse(summary.endedAt));
    effective.laps().forEach((lap, i) => {
      if (i < distances.length) distances[i] += lap.distanceMeters;
    });
    previous = points.at(-1);
    progress?.(page.next);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    laps: ranges.map((r, i) => analyzePace(r.startMs, r.endMs, distances[i])),
    intervals: stopIntervals(control, Date.parse(summary.endedAt)),
  };
}
