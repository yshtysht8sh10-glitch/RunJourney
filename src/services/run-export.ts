import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Backup, exportFilename, MAX_BACKUP_BYTES, parseBackup } from '@/utils/run-backup';
import { serializeAnalysis } from '@/utils/run-analysis-export';
import { RunRecord } from '@/types/run';
import * as Crypto from 'expo-crypto';
import { database } from '@/repositories/database';
import { decodeBackup, encodeBackup } from '@/repositories/sqlite-backup';
import { SqlSnapshot } from '@/repositories/sqlite-store';

async function share(text: string, name: string, mimeType: string) {
  if (!await Sharing.isAvailableAsync()) throw new Error('この端末ではファイル共有を利用できません');
  const dot = name.lastIndexOf('.');
  const file = new File(Paths.cache, `${name.slice(0,dot)}-${Crypto.randomUUID()}${name.slice(dot)}`);
  file.create({ overwrite: false });
  try { file.write(text); await Sharing.shareAsync(file.uri, { mimeType, UTI: mimeType === 'application/json' ? 'public.json' : 'net.daringfireball.markdown', dialogTitle: 'Exportを保存 / 共有' }); }
  finally { if (file.exists) file.delete(); }
}
export async function exportBackup() {
  const now = Date.now();
  const text = await encodeBackup(await database(), digest, new Date(now).toISOString());
  await share(text, exportFilename('backup', now), 'application/json');
}
export async function pickBackup(): Promise<{ name: string; backup: Backup; snapshot?: SqlSnapshot } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0], file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size) > MAX_BACKUP_BYTES) throw new Error('バックアップが大きすぎます（上限50MB）');
    const text = await file.text();
    if (JSON.parse(text)?.format === 'runjourney-sqlite-backup') {
      const backup = await decodeBackup(text, digest);
      return { name: asset.name, snapshot: backup.snapshot, backup: { format: 'runjourney-backup' as const, schemaVersion: 1 as const, exportedAt: Date.parse(backup.exportedAt), app: {}, runs: backup.snapshot.runs } };
    }
    return { name: asset.name, backup: parseBackup(text), snapshot: undefined };
  } finally { if (file.exists) file.delete(); }
}
export async function exportAnalysis(run: RunRecord) {
  await share(serializeAnalysis(run), exportFilename('run', Date.parse(run.startedAt)), 'text/markdown');
}
const digest = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);

export async function exportVoiceLog(text: string) {
  await share(text, `runjourney-voice-${Date.now()}.json`, 'application/json');
}
