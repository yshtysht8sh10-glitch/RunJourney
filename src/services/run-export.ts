import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { RunRepository } from '@/repositories/run-repository';
import { exportFilename, MAX_BACKUP_BYTES, parseBackup, serializeBackup } from '@/utils/run-backup';
import { serializeAnalysis } from '@/utils/run-analysis-export';
import { RunRecord } from '@/types/run';

async function share(text: string, name: string, mimeType: string) {
  if (!await Sharing.isAvailableAsync()) throw new Error('この端末ではファイル共有を利用できません');
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true }); file.write(text);
  try { await Sharing.shareAsync(file.uri, { mimeType, UTI: mimeType === 'application/json' ? 'public.json' : 'net.daringfireball.markdown', dialogTitle: 'Exportを保存 / 共有' }); }
  finally { if (file.exists) file.delete(); }
}
export async function exportBackup() {
  const now = Date.now();
  const text = serializeBackup(await RunRepository.getBackupRuns(), {
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown',
    versionCode: Application.nativeBuildVersion, applicationId: Application.applicationId,
    gitCommit: Constants.expoConfig?.extra?.buildGitHash ?? 'unknown',
  }, now);
  await share(text, exportFilename('backup', now), 'application/json');
}
export async function pickBackup() {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0], file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size) > MAX_BACKUP_BYTES) throw new Error('バックアップが大きすぎます（上限50MB）');
    return { name: asset.name, backup: parseBackup(await file.text()) };
  } finally { if (file.exists) file.delete(); }
}
export async function exportAnalysis(run: RunRecord) {
  await share(serializeAnalysis(run), exportFilename('run', Date.parse(run.startedAt)), 'text/markdown');
}
