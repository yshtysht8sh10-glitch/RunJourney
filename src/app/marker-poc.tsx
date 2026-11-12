import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isStandaloneTest } from '@/utils/build';
import { RunRepository } from '@/repositories/run-repository';

type Status = { state: string; count?: number; mode?: string; lastLabel?: string; failure?: string; endReason?: string; ready?: boolean };
function bridge() {
  if (Platform.OS !== 'android' || !isStandaloneTest()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}
export default function MarkerPoc() {
  const [status, setStatus] = useState<Status>({ state: 'OFF' });
  const [pending, setPending] = useState(false);
  useFocusEffect(useCallback(() => {
    const read = () => { try { setStatus(JSON.parse(bridge()?.markerStats?.() ?? '{"state":"UNAVAILABLE"}')); } catch { setStatus({ state: 'UNAVAILABLE' }); } };
    read(); const timer = setInterval(read, 500); return () => clearInterval(timer);
  }, []));
  const control = async (action: 'trial' | 'field' | 'off') => {
    setPending(true);
    try {
      if (action !== 'off' && await RunRepository.getActiveRun()) throw Error('START前に準備してください。RUNのタイマーは操作しません。');
      if (!bridge()?.markerControl?.(action)) throw Error('マーカーを開始できません。対応Test版と状態を確認してください。');
    } catch (e) { Alert.alert('マーカー', String(e)); } finally { setPending(false); }
  };
  const busy = ['STARTING', 'RECORDING', 'CLOSING'].includes(status.state);
  const voiceTrial = async () => {
    setPending(true);
    try {
      if (await RunRepository.getActiveRun()) throw Error('実RUN中は音声試験を使えません。');
      const native = bridge();
      if (!native?.markerControl?.('trial')) throw Error('先の試験を終了してください。');
      let ready = false;
      for (let n = 0; n < 100; n++) {
        const current: Status = JSON.parse(native.markerStats?.() ?? '{}');
        if (current.state === 'RECORDING' && current.ready) { ready = true; break; }
        if (current.state === 'FAILED') throw Error(current.failure);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!ready) throw Error('マーカーの準備が完了しませんでした。');
      const now = Date.now(), runId = `marker-preview-${now}`;
      const message = 'これは音声案内中のマーカー試験です。ボタンを一秒間隔で十回押してください。この一分で五秒貯金が増えました。八点三キロを通過。ここまでの走行で貯金は三十六秒です。これは実際の走行記録ではありません。音声が途中で切れず、最後まで聞こえるか確認してください。音声の干渉確認を終了します。';
      await native.notifyBatch?.(JSON.stringify({ runId, state: 'RUNNING', paused: false, latestEventIndex: -1,
        notices: [{ id: `${runId}:voice`, type: 'FIVE_MINUTES', priority: 40, message, generatedAt: now, expiresAt: now + 60000,
          data: { runId, simulation: true } }] }));
    } catch (e) { Alert.alert('音声試験', String(e)); } finally { setPending(false); }
  };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>実停止マーカー（Test PoC）</Text>
    <Text style={styles.text}>RUN・GPS・Auto Stopを変更しない独立記録です。採用前の実機試験が必要です。</Text>
    <Text accessibilityLiveRegion="polite" style={styles.status}>状態: {status.state} / 保存: {status.count ?? 0}件 / {status.mode ?? ''}</Text>
    {busy && <Text style={styles.text}>{status.ready ? 'ボタン受付中' : '準備・終了処理中'}</Text>}
    <Text style={styles.text}>直近: {status.lastLabel || 'なし'}</Text>
    {!!status.endReason && <Text style={styles.text}>終了理由: {status.endReason}</Text>}
    {!!status.failure && <Text style={styles.error}>{status.failure}</Text>}
    <Pressable disabled={pending || busy} style={[styles.button, busy && styles.disabled]} onPress={() => void control('trial')}><Text style={styles.text}>試し押し（10回で終了）</Text></Pressable>
    <Pressable disabled={pending || busy} style={[styles.button, busy && styles.disabled]} onPress={() => void voiceTrial()}><Text style={styles.text}>音声中の試し押し（開始）</Text></Pressable>
    <Pressable disabled={pending || busy} style={[styles.button, busy && styles.disabled]} onPress={() => void control('field')}><Text style={styles.text}>実走マーカー開始（START前）</Text></Pressable>
    <Pressable disabled={pending || !busy} style={[styles.button, !busy && styles.disabled]} onPress={() => void control('off')}><Text style={styles.text}>マーカーのみ終了（RUNは継続）</Text></Pressable>
    <Text style={styles.text}>開始音の後、実際に止まったら再生ボタンを1回、走り出すときに1回。STOP/RESUMEを交互に自己申告します。音声通知やGPSの状態でラベルを選びません。</Text>
    <Text style={styles.text}>試し押しは実走とは別ファイル。実走開始で件数を0に戻します。RUN開始・終了はラン画面で通常どおり操作し、終了後にここでマーカーも終了してください。</Text>
    <Text style={styles.text}>暗号化して端末内保存。キー時刻が取れない機種は端末受信時刻のみで、実停止の厳密な時刻ではありません。再起動・切断・押し忘れは未検証区間にします。Test限定の受信維持処理による電池増分は未測定です。</Text>
    <Pressable disabled={busy} style={[styles.button, busy && styles.disabled]} onPress={() => void (async () => { try {
      const text = await bridge()?.markerRead?.(); if (!text) throw Error('保存記録なし');
      await Share.share({ title: 'RunJourney marker log', message: text });
    } catch (e) { Alert.alert('読取りできませんでした', String(e)); } })()}><Text style={styles.text}>直近マーカーを認証・復号して共有</Text></Pressable>
    <Pressable style={styles.button} onPress={() => router.push('/')}><Text style={styles.text}>ラン画面へ</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({screen:{flex:1,backgroundColor:'#111418'},content:{padding:20,gap:14},title:{color:'#fff',fontSize:23,fontWeight:'700'},text:{color:'#fff',fontSize:16,lineHeight:24},status:{color:'#7ee0b3',fontSize:18},error:{color:'#ffb0a8'},button:{backgroundColor:'#303941',padding:16,borderRadius:10},disabled:{opacity:0.4}});
