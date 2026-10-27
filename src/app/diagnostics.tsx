import { useCallback, useMemo, useRef, useState } from 'react';
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
import { exportVoiceLog } from '@/services/run-export';
import { verifyVoiceLog } from '@/domain/voice-log';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { summarizeStopLatency } from '@/domain/stop-latency';
import { AdaptiveAudio } from '@/services/adaptive-audio';

export default function Diagnostics() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [settings, setSettings] = useState({ autoStop: false, break: false });
  const [error, setError] = useState('');
  const [voiceLog, setVoiceLog] = useState('[]');
  const [exportingVoice, setExportingVoice] = useState(false);
  const [latency, setLatency] = useState<ReturnType<typeof summarizeStopLatency> | null>(null);
  const voiceExportLock = useRef(false);
  const load = useCallback(async () => {
    if (!isStandaloneTest()) return;
    try {
      setVoiceLog(await VoiceAnnouncement.debugLog());
      const [active, page, storedSettings] = await Promise.all([RunRepository.getActiveRun(), RunRepository.getHistoryPage(1), RunSettings.get()]);
      const saved = id ? await RunRepository.getRun(id) : page.length ? await RunRepository.getRun(page[0].id) : null;
      setRun(id ? saved : latestDiagnosticRun(active, saved ? [saved] : []));
      setSettings(storedSettings); setError(await RunRepository.getStorageWarning() ?? '');
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
  const exportVoice = async () => {
    if (voiceExportLock.current) return;
    voiceExportLock.current = true; setExportingVoice(true);
    try {
      const full = await VoiceAnnouncement.debugLog(20000);
      const summary = summarizeStopLatency(JSON.parse(full), run?.id);
      setLatency(summary);
      await exportVoiceLog(JSON.stringify({ version: 2, entries: JSON.parse(full), verification: verifyVoiceLog(full), latencySummary: summary, noise: AdaptiveAudio.diagnostics() }));
    } catch (e) { Alert.alert('出力できませんでした', String(e)); }
    finally { voiceExportLock.current = false; setExportingVoice(false); }
  };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Pressable onPress={() => id ? router.replace({ pathname: '/run-detail', params: { id } }) : router.replace('/settings')} style={styles.button}><Text style={styles.text}>‹ 戻る</Text></Pressable>
    <Text style={styles.title}>Auto Stop Diagnostics</Text>
    {!isStandaloneTest() ? <Text style={styles.text}>Standalone Test版専用です。</Text> : <>
      <Pressable accessibilityRole="button" onPress={load} style={styles.button}><Text style={styles.text}>最新情報に更新</Text></Pressable>
      <Text style={styles.text}>音声デバッグログ（端末内・最大20,000イベント / 20MB / 7日）</Text>
      <Pressable accessibilityRole="button" disabled={exportingVoice} style={styles.button} onPress={exportVoice}><Text style={styles.text}>{exportingVoice ? '音声ログを出力中…' : '音声ログ JSONをExport'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={exportingVoice} style={styles.button} onPress={() => {
        setExportingVoice(true);
        void VoiceAnnouncement.debugLog(20000).then(text => setLatency(summarizeStopLatency(JSON.parse(text), run?.id)))
          .catch(error => Alert.alert('集計できませんでした', String(error))).finally(() => setExportingVoice(false));
      }}><Text style={styles.text}>停止・通知の遅延サマリーを集計</Text></Pressable>
      {latency && <Text selectable style={styles.log}>{JSON.stringify({ stages: latency.stages, reasons: latency.reasons, candidateCount: latency.candidates.length, limitations: latency.limitations, noise: AdaptiveAudio.diagnostics() }, null, 2)}</Text>}
      <Text selectable style={styles.log}>{JSON.stringify(JSON.parse(voiceLog).slice(-12), null, 2)}</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
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
