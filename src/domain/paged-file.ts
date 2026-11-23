import { PagedRunSource, hashText } from "./pages";
import { prepareManifest } from "../sync/paged-protocol";
import { canonical } from "../utils/run-backup-canonical";
// Consumer writes each line directly to a file/stream; never joins the Run.
export async function* pagedFileLines(
  sources: AsyncIterable<PagedRunSource> | Iterable<PagedRunSource>,
) {
  yield canonical({ format: "runjourney-paged", schemaVersion: 2 }) + "\n";
  for await (const source of sources) {
    const manifest = await prepareManifest(source);
    yield canonical({ type: "run", manifest }) + "\n";
    for (const p of manifest.pages) {
      const page = await source.read(p.kind, p.start);
      if (hashText(canonical(page)) !== p.hash)
        throw new Error(
          "Export中にページ内容が変化しました。未完了ファイルとして停止します",
        );
      yield canonical({
        type: "page",
        runId: manifest.summary.id,
        hash: p.hash,
        page,
      }) + "\n";
    }
    yield canonical({
      type: "end-run",
      runId: manifest.summary.id,
      hash: hashText(canonical(manifest)),
    }) + "\n";
  }
}
