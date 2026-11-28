import { requireOptionalNativeModule } from 'expo-modules-core';

/** Lengths and offsets are Unicode codepoints, not JavaScript UTF-16 units. */
export type LegacyEntry = { key: string; length: number; sha256: string };
export type LegacyOpen = { applicationId: string; token: string | null; entries: LegacyEntry[] };
export type LegacyChunk = { text: string; nextOffset: number; done: boolean };
type Reader = {
  activityRecordHeader?(kind: 'running' | 'cycling', id: string): ReturnType<NonNullable<Reader['activityMetadata']>>;
  activityMetadata?(kind: 'running' | 'cycling', mode: 'draft' | 'history', limit: number, offset: number): Promise<{ exists: boolean; rows: { id: string; startedAt: string; endedAt: string | null; distanceMeters: number; activeRunningTime: number }[] }>;
  open(): Promise<LegacyOpen>;
  read(token: string, key: string, offset: number): Promise<LegacyChunk>;
  close(token: string): Promise<void>;
};
const native = requireOptionalNativeModule<Reader>('LegacyStorageReader');
const unavailable = () => Promise.reject(new Error('Legacy storage reader is unavailable'));
export default {
  available: native !== null,
  activityRecordHeader: (kind: 'running' | 'cycling', id: string) => {
    if (!native?.activityRecordHeader) return Promise.reject(new Error('Activity completion reader is unavailable'));
    return native.activityRecordHeader(kind, id);
  },
  activityMetadata: (kind: 'running' | 'cycling', mode: 'draft' | 'history', limit = 128, offset = 0) => {
    if (!native?.activityMetadata) return Promise.reject(new Error('Activity metadata reader is unavailable'));
    return native.activityMetadata(kind, mode, limit, offset);
  },
  open: (): Promise<LegacyOpen> => native ? native.open() : unavailable(),
  read: (token: string, key: string, offset: number): Promise<LegacyChunk> => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 32 * 1024 * 1024) return Promise.reject(new Error('LEGACY_OFFSET_INVALID'));
    return native ? native.read(token, key, offset) : unavailable();
  },
  close: (token: string): Promise<void> => native ? native.close(token) : unavailable(),
};
