import { File, Paths, FileMode } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import { RunRepository } from "../repositories/run-repository";
import { pagedFileLines } from "../domain/paged-file";
export async function exportPagedRun(id: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("この端末では共有を利用できません");
  const file = new File(
    Paths.cache,
    `runjourney-paged-${Crypto.randomUUID()}.ndjson`,
  );
  file.create({ overwrite: false });
  let handle: ReturnType<File["open"]> | undefined;
  try {
    handle = file.open(FileMode.WriteOnly);
    for await (const line of pagedFileLines([RunRepository.pagedSource(id)])) {
      handle.writeBytes(new TextEncoder().encode(line));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    handle.close();
    handle = undefined;
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/x-ndjson",
      dialogTitle: "GPSページファイルを保存 / 共有",
    });
  } finally {
    handle?.close();
    if (file.exists) file.delete();
  }
}
