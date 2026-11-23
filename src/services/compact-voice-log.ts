export type CompactVoiceReader = {
  compactVoiceStats?(runId: string): Promise<string>;
  compactVoicePage?(runId: string, offset: number, endOffset: number): Promise<string>;
};
export const COMPACT_VOICE_MAX_BYTES = 8 * 1024 * 1024;
function object(text: string): Record<string, unknown> {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('音声追跡ログの形式が不正です');
  return value;
}
export async function compactVoiceStats(reader: CompactVoiceReader, runId: string) {
  if (!reader.compactVoiceStats) throw Error('このAPKはRUN全区間の音声追跡ログに未対応です');
  return object(await reader.compactVoiceStats(runId));
}
/** Fixed byte cutoff, so concurrent append/export cannot change this export's range. */
export async function readCompactVoiceLog(reader: CompactVoiceReader, runId: string) {
  if (!reader.compactVoicePage) throw Error('このAPKはRUN全区間の音声追跡ログに未対応です');
  const initial = await compactVoiceStats(reader, runId);
  const end = initial.readableBytes;
  if (typeof end !== 'number' || !Number.isSafeInteger(end) || end < 0 || end > COMPACT_VOICE_MAX_BYTES) throw Error('音声追跡ログの容量情報が不正です');
  if (typeof initial.records !== 'number' || !Number.isSafeInteger(initial.records) || initial.records < 0 || initial.records > 100_000) throw Error('音声追跡ログの件数情報が不正です');
  const entries: unknown[] = [];
  let offset = 0;
  while (offset < end) {
    const page = object(await reader.compactVoicePage(runId, offset, end));
    if (!Array.isArray(page.entries) || !page.entries.length || page.entries.length > 128 || typeof page.nextOffset !== 'number' || !Number.isSafeInteger(page.nextOffset) ||
      page.nextOffset <= offset || page.nextOffset > end || page.done !== (page.nextOffset === end)) throw Error('音声追跡ログのページ順序が不正です');
    for (const record of page.entries) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || record.seq !== entries.length + 1) throw Error('音声追跡ログの連番が一致しません');
      entries.push(record);
    }
    if (entries.length > 100_000) throw Error('音声追跡ログの件数上限を超えています');
    offset = page.nextOffset;
  }
  if (entries.length !== initial.records) throw Error('音声追跡ログの件数が一致しません');
  return JSON.stringify({ format: 'runjourney-compact-voice', version: 1, exportedAt: Date.now(),
    snapshot: initial, finalStatus: await compactVoiceStats(reader, runId), entries });
}
