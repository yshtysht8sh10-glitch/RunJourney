import { compactVoiceStats, readCompactVoiceLog, COMPACT_VOICE_MAX_BYTES, type CompactVoiceReader } from '../../services/compact-voice-log';
const reader = (): CompactVoiceReader => ({ compactVoiceStats: jest.fn().mockResolvedValue(JSON.stringify({ readableBytes: 20, records: 2, dropped: 0 })),
  compactVoicePage: jest.fn(async (_run, offset) => JSON.stringify({ entries: [{ seq: offset / 10 + 1, type: 'PACE_WARNING', at: offset }], nextOffset: offset + 10, done: offset === 10 })) });
test('export uses one fixed byte cutoff and includes initial and final loss status', async () => {
  const native = reader(); jest.mocked(native.compactVoiceStats!).mockResolvedValueOnce('{"readableBytes":20,"records":2,"dropped":0}').mockResolvedValueOnce('{"readableBytes":30,"records":3,"dropped":1}');
  const out = JSON.parse(await readCompactVoiceLog(native, 'synthetic-run'));
  expect(out.entries).toHaveLength(2); expect(out.snapshot.readableBytes).toBe(20); expect(out.finalStatus.dropped).toBe(1);
  expect(native.compactVoicePage).toHaveBeenNthCalledWith(1, 'synthetic-run', 0, 20);
  expect(native.compactVoicePage).toHaveBeenNthCalledWith(2, 'synthetic-run', 10, 20);
});
test('unsupported and invalid stats fail visibly, not as an empty success', async () => {
  await expect(compactVoiceStats({}, 'r')).rejects.toThrow('未対応');
  for (const size of [-1, 1.5, COMPACT_VOICE_MAX_BYTES + 1, '20']) {
    const native = reader(); jest.mocked(native.compactVoiceStats!).mockResolvedValue(JSON.stringify({ readableBytes: size }));
    await expect(readCompactVoiceLog(native, 'r')).rejects.toThrow('容量');
  }
});
test('offset regressions, overshoot, inconsistent terminal flags and malformed entries are rejected', async () => {
  for (const page of [{ entries: [], nextOffset: 0, done: false }, { entries: [], nextOffset: 30, done: true },
    { entries: [], nextOffset: 10, done: true }, { entries: {}, nextOffset: 20, done: true }]) {
    const native = reader(); jest.mocked(native.compactVoicePage!).mockResolvedValue(JSON.stringify(page));
    await expect(readCompactVoiceLog(native, 'r')).rejects.toThrow('ページ');
  }
});
test('empty trace retains explicit metadata and never requests a page', async () => {
  const native = reader(); jest.mocked(native.compactVoiceStats!).mockResolvedValue('{"readableBytes":0,"records":0,"stoppedReason":"NO_TRACE"}');
  const out = JSON.parse(await readCompactVoiceLog(native, 'r'));
  expect(out.entries).toEqual([]); expect(out.snapshot.stoppedReason).toBe('NO_TRACE'); expect(native.compactVoicePage).not.toHaveBeenCalled();
});
test('record sequence and final snapshot count mismatches cannot be exported as complete', async () => {
  const native = reader();
  jest.mocked(native.compactVoicePage!).mockResolvedValue('{"entries":[{"seq":2}],"nextOffset":20,"done":true}');
  await expect(readCompactVoiceLog(native, 'r')).rejects.toThrow('連番');
  jest.mocked(native.compactVoicePage!).mockResolvedValue('{"entries":[{"seq":1}],"nextOffset":20,"done":true}');
  await expect(readCompactVoiceLog(native, 'r')).rejects.toThrow('件数');
});
