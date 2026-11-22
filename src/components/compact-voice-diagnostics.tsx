import { useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import native from '../../modules/run-announcer';
import { compactVoiceStats, readCompactVoiceLog } from '../services/compact-voice-log';
import { exportVoiceLog } from '../services/run-export';

export function CompactVoiceDiagnostics({ runId }: { runId?: string }) {
  return <CompactVoiceDiagnosticsForRun key={runId ?? 'none'} runId={runId} />;
}
function CompactVoiceDiagnosticsForRun({ runId }: { runId?: string }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const perform = async (exporting: boolean) => {
    if (!runId || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await compactVoiceStats(native, runId); setStats(next);
      if (exporting) await exportVoiceLog(await readCompactVoiceLog(native, runId));
    } catch (e) { const message = e instanceof Error ? e.message : '読み取れませんでした'; setError(message); if (exporting) Alert.alert('音声追跡ログ', message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <View style={{ gap: 10, paddingVertical: 16 }}>
    <Text style={{ color: '#fff', fontSize: 17 }}>RUN全区間の音声追跡（Test）</Text>
    <Text style={{ color: '#bbb' }}>この版以降の新規ログです。旧ログとは別保存です。記録中のExportは押した時点までの範囲を固定します。容量超過・欠落フラグがある場合は全件保存成功と扱いません。</Text>
    {!runId && <Text style={{ color: '#fff' }}>対象RUNがありません。</Text>}
    <Pressable accessibilityRole="button" disabled={!runId || busy} onPress={() => { void perform(false); }} style={{ padding: 14, backgroundColor: '#33424C', borderRadius: 12 }}><Text style={{ color: '#fff' }}>{busy ? '処理中…' : '全区間ログの保存状態を確認'}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={!runId || busy} onPress={() => { void perform(true); }} style={{ padding: 14, backgroundColor: '#33424C', borderRadius: 12 }}><Text style={{ color: '#fff' }}>全区間の音声追跡JSONをExport</Text></Pressable>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#ffbaad' }}>{error}</Text>}
    {stats && <Text selectable style={{ color: '#bbb' }}>{JSON.stringify(stats, null, 2)}</Text>}
  </View>;
}
