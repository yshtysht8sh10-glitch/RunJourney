import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RunRepository } from '@/repositories/run-repository';
import { exportBackup, pickBackup } from '@/services/run-export';
import { Backup, previewImport } from '@/utils/run-backup';

type Preview = ReturnType<typeof previewImport> & { name: string; backup: Backup };
export default function DataTransfer() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await action(); }
    catch (error) { Alert.alert('処理できませんでした', error instanceof Error ? error.message : String(error)); }
    finally { locked.current = false; setBusy(false); }
  };
  const select = () => perform(async () => {
    setPreview(null);
    const selected = await pickBackup();
    if (selected) setPreview({ ...selected, ...previewImport(selected.backup.runs, await RunRepository.getBackupRuns()) });
  });
  const confirm = () => {
    if (!preview || busy) return;
    Alert.alert('Importを実行しますか？', `${preview.additions.length}件を追加予定です。重複はスキップし、既存記録を優先します。実行直前にも重複を再確認します。`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '追加する', onPress: () => perform(async () => {
        // Only the preview-approved additions may be committed; a record deleted
        // after preview must not turn a skipped duplicate into an unexpected restore.
        const result = await RunRepository.importRuns(preview.additions);
        setPreview(null);
        Alert.alert('Import完了', `${result.added}件を追加しました\n${result.skipped + preview.duplicates}件の重複をスキップしました`, [{ text: '履歴を見る', onPress: () => router.push('/history') }, { text: 'OK' }]);
      }) },
    ]);
  };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.back()} style={styles.button}><Text style={styles.text}>‹ 設定に戻る</Text></Pressable>
    <Text style={styles.title}>データ / Export・Import</Text>
    <Text style={styles.text}>Backup v1：走行履歴とごみ箱を保存します。設定・進行中の走行は対象外です。</Text>
    <Text style={styles.note}>バックアップには正確な位置情報（Raw GPS）が含まれます。共有先や保存先に注意してください。</Text>
    <Pressable testID="backup-export" accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => Alert.alert('位置情報を含むバックアップ', 'バックアップには位置情報が含まれます。共有時は注意してください。', [{ text: 'キャンセル', style: 'cancel' }, { text: 'Export', onPress: () => perform(exportBackup) }])}><Text style={styles.text}>Backup JSONをExport</Text></Pressable>
    <Pressable testID="backup-select" accessibilityRole="button" disabled={busy} style={styles.button} onPress={select}><Text style={styles.text}>Backup JSONを選択（Preview）</Text></Pressable>
    {busy && <Text style={styles.note}>処理中…</Text>}
    {preview && <>
      <Text style={styles.title}>Import Preview</Text>
      <Text style={styles.text}>ファイル：{preview.name}{'\n'}記録数：{preview.total}件{'\n'}新規：{preview.additions.length}件{'\n'}重複のためスキップ：{preview.duplicates}件{'\n'}ごみ箱（ファイル内）：{preview.trash}件{'\n'}Import対象：{preview.additions.length}件</Text>
      {preview.oldest !== null && <Text style={styles.text}>最古：{new Date(preview.oldest).toLocaleDateString('ja-JP')}{'\n'}最新：{new Date(preview.newest!).toLocaleDateString('ja-JP')}</Text>}
      <Text style={styles.note}>まだ保存していません。既存データは上書きしません。ごみ箱の状態と移動日時を保持します。7日を過ぎたごみ箱の記録は、次の通常履歴・ごみ箱表示時に削除されます。</Text>
      <Pressable testID="backup-confirm" accessibilityRole="button" disabled={busy} style={styles.button} onPress={confirm}><Text style={styles.text}>確認してImport</Text></Pressable>
      <Pressable testID="backup-cancel" accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => setPreview(null)}><Text style={styles.text}>キャンセル</Text></Pressable>
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111418' }, content: { padding: 24, paddingBottom: 48 },
  title: { color: '#F5F2EB', fontSize: 25, fontWeight: '700', marginVertical: 24 },
  text: { color: '#F5F2EB', fontSize: 16, lineHeight: 26 }, note: { color: '#A6A7A9', fontSize: 14, lineHeight: 23, marginVertical: 16 },
  button: { minHeight: 52, backgroundColor: '#33424C', borderRadius: 12, padding: 14, marginTop: 12 },
});
