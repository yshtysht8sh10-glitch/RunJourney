import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { RunRepository } from '@/repositories/run-repository';
import { SensorDiagnostics } from '@/services/sensor-diagnostics';
import { DetectorJournal } from '@/services/detector-journal';

function bridge() {
  if (Platform.OS !== 'android' || Application.applicationId !== 'app.runjourney.mobile.test') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
}
export default function SensorDiagnosticsScreen() {
  const [status, setStatus] = useState<Record<string, unknown>>({ state: 'OFF' });
  const [position, setPosition] = useState('WAIST_POUCH');
  const [pending, setPending] = useState(false);
  useFocusEffect(useCallback(() => {
    const read = () => { try { setStatus(JSON.parse(bridge()?.sensorStats?.() ?? '{"state":"UNAVAILABLE"}')); } catch { /* Preserve display. */ } };
    read(); const timer = setInterval(read, 1000); return () => clearInterval(timer);
  }, []));
  const action = async (name: 'arm' | 'armMetrics' | 'off' | 'bench') => {
    setPending(true);
    try {
      if (name !== 'off' && await RunRepository.getActiveRun()) throw Error('RUN開始前に準備してください。実RUN中の試験開始は禁止です。');
      if (['arm', 'armMetrics'].includes(name) && DetectorJournal.status !== 'ARMED') throw Error('先にAuto Stop Diagnosticsで「次のRUNの診断をON」にしてください。');
      if (!SensorDiagnostics.control(name, position)) throw Error('開始できません。対応Test APK・時計拡張・終了状態を確認してください。');
    } catch (e) { Alert.alert('センサー診断', String(e)); } finally { setPending(false); }
  };
  const busy = ['STARTING', 'RECORDING', 'CLOSING'].includes(String(status.state));
  const button = (title: string, onPress: () => void, disabled = false) => <Pressable disabled={pending || disabled} style={[styles.button, disabled && { opacity: .4 }]} onPress={onPress}><Text style={styles.text}>{title}</Text></Pressable>;
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>加速度・ジャイロ診断（Test）</Text>
    <Text style={styles.status}>状態: {String(status.state)} / {String(status.mode ?? '')}</Text>
    <Text style={styles.text}>判定・音声には使いません。通常RUNのSTARTが別に必要です。要求25Hz、95分上限。終了後もRUNは継続します。</Text>
    <Text style={styles.text}>装着位置（RUN前に選択）</Text>
    {([['WAIST_POUCH', '腰ポーチ'], ['POCKET', 'ポケット'], ['HAND', '手持ち'], ['ARM', '腕'], ['OTHER', 'その他']] as const).map(([value, label]) => <Pressable key={value} disabled={busy} style={styles.button} onPress={() => setPosition(value)}><Text style={styles.text}>{position === value ? '● ' : '○ '}{label}</Text></Pressable>)}
    {button('次のRUNのセンサー診断をON（ARMED）', () => void action('arm'), busy)}
    {button('比較用：センサーOFF・時計/負荷だけ記録（ARMED）', () => void action('armMetrics'), busy)}
    {button('センサー診断だけ終了 / OFF', () => void action('off'))}
    {button('診断保存失敗の試験（RUNは継続）', () => {
      Alert.alert('診断だけを不完全終了します', '実走の採取には使わず、端末内検証時だけ実行してください。RUNは停止しません。', [
        { text: 'キャンセル', style: 'cancel' }, { text: '診断保存失敗を発生', onPress: () => { SensorDiagnostics.control('testWriteFailure'); } },
      ]);
    }, String(status.state) !== 'RECORDING')}
    {button('机上60秒採取（RUNは開始しない）', () => void action('bench'), busy)}
    <Text style={styles.text}>実走では元GPS診断もARMEDにしてください。5条件の順番：直立→足プラプラ→その場で弾む→歩行→走行Uターン→走行Uターン→歩行→その場で弾む→足プラプラ→直立。</Text>
    <Text style={styles.text}>各区間の開始と終了でShokzを1回ずつ、合計20回。歩行・Uターンでは止まらず、区間境界を押します。動作は本人の申告ラベルで、センサーから正解を生成しません。</Text>
    {button('5条件マーカー画面へ', () => router.push('/marker-poc'))}
    {button('認証・保存件数を確認（共有は本人操作）', () => void (async () => {
      try { const result = await bridge()?.sensorRead?.(); if (!result) throw Error('保存記録なし'); await Share.share({ title: 'Sensor diagnostic verification', message: result }); }
      catch (e) { Alert.alert('認証読取り', String(e)); }
    })(), busy)}
    <Text selectable style={styles.text}>{JSON.stringify(status, null, 2)}</Text>
    {button('ラン画面へ（通常START）', () => router.push('/'))}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#111418' }, content: { padding: 20, gap: 12 }, title: { color: '#fff', fontSize: 22, fontWeight: '700' }, text: { color: '#fff', fontSize: 16, lineHeight: 24 }, status: { color: '#7ee0b3', fontSize: 20 }, button: { backgroundColor: '#303941', padding: 14, borderRadius: 10 } });
