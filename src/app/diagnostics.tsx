import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RunRepository } from '@/repositories/run-repository';
import { RunSettings } from '@/repositories/run-settings';
import { ActiveRun } from '@/types/run';
import { diagnosticReport, latestDiagnosticRun } from '@/utils/auto-stop-diagnostics';
import { isStandaloneTest } from '@/utils/build';
import { VoiceAnnouncement } from '@/services/voice-announcement';

export default function Diagnostics() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [settings, setSettings] = useState({ autoStop: false, break: false });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!isStandaloneTest()) return;
    try {
      const [active, runs, storedSettings] = await Promise.all([RunRepository.getActiveRun(), RunRepository.getRuns(), RunSettings.get()]);
      setRun(id ? runs.find(r => r.id === id) ?? null : latestDiagnosticRun(active, runs));
      setSettings(storedSettings); setError('');
    } catch { setError('診断情報を読み込めませんでした'); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const report = useMemo(() => run ? diagnosticReport(run, String(Constants.expoConfig?.extra?.buildGitHash ?? 'unknown')) : null, [run]);
  const payload = report ? JSON.stringify({ ...report, currentSettings: settings, voice: VoiceAnnouncement.diagnostics() }) : '';
  // Keep the phone view light; Copy/Share includes the retained full report.
  const display = report ? JSON.stringify({ observation: report.observation, quality: report.quality, actualEvents: report.actualEvents,
    actualCounts: report.actualDiagnostics ? Object.fromEntries(Object.entries(report.actualDiagnostics.counts).filter(([key]) => !key.startsWith('GPS_OBS_'))) : null, legacyReplay: report.legacyV4Replay,
    currentReplayCounts: report.currentReplay.diagnostics?.counts,
    latestEntries: (report.actualDiagnostics?.entries ?? report.currentReplay.diagnostics?.entries ?? []).slice(-20) }, null, 2) : '';
  const copy = async () => { try { await Clipboard.setStringAsync(payload); Alert.alert('コピーしました', 'この会話へ貼り付けてください。'); } catch (err) { Alert.alert('コピーできませんでした', String(err)); } };
  const share = async () => { try { await Share.share({ message: payload, title: 'RunJourney Auto Stop Diagnostics' }); } catch (err) { Alert.alert('共有できませんでした', String(err)); } };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Pressable onPress={() => id ? router.replace({ pathname: '/run-detail', params: { id } }) : router.replace('/settings')} style={styles.button}><Text style={styles.text}>‹ 戻る</Text></Pressable>
    <Text style={styles.title}>Auto Stop Diagnostics</Text>
    {!isStandaloneTest() ? <Text style={styles.text}>Standalone Test版専用です。</Text> : <>
      <Pressable accessibilityRole="button" onPress={load} style={styles.button}><Text style={styles.text}>最新情報に更新</Text></Pressable>
      {!report ? <Text style={styles.text}>{error || '記録がありません'}</Text> : <>
        <Text style={styles.text}>Run snapshot: Auto Stop {report.featuresSnapshot.autoStop ? 'ON' : 'OFF'} / Break {report.featuresSnapshot.break ? 'ON' : 'OFF'}</Text>
        <Text style={styles.text}>保存GPS {report.rawPointCount}件 / 保存イベント {report.actualEvents.length}件</Text>
        {report.observation && <Text style={styles.text}>観測 {report.observation.observationCount}件 / バッファ最大 {report.observation.maxBufferSize}件</Text>}
        <Text style={styles.text}>実記録と仮想再判定は別表示です。旧版には実診断ログがありません。座標は共有しません。</Text>
        <Pressable accessibilityRole="button" onPress={copy} style={styles.button}><Text style={styles.text}>診断ログをコピー</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={share} style={styles.button}><Text style={styles.text}>診断ログを共有</Text></Pressable>
        <Text style={styles.text}>画面は直近20件。コピー/共有には保持中の全診断を含みます。</Text>
        <Text selectable style={styles.log}>{display}</Text>
      </>}
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#111418' }, content: { padding: 24, paddingBottom: 48 },
  title: { color: '#F5F2EB', fontSize: 25, fontWeight: '700', marginVertical: 24 }, text: { color: '#F5F2EB', fontSize: 15, lineHeight: 25 },
  log: { color: '#A6A7A9', fontSize: 12, lineHeight: 18, marginTop: 24 }, button: { minHeight: 52, backgroundColor: '#33424C', borderRadius: 12, padding: 14, marginTop: 12 } });
