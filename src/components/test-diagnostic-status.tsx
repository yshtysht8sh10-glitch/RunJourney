import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SensorDiagnostics } from '@/services/sensor-diagnostics';
import { DetectorJournal } from '@/services/detector-journal';

type Sensor = { notificationsAllowed?: boolean; state?: string; displayState?: string; warning?: string; endReason?: string; auditFailure?: string;
  accel?: { count?: number; actualHz?: number }; gyro?: { count?: number; actualHz?: number };
  accelLastReceivedAgoMs?: number; gyroLastReceivedAgoMs?: number };
type Marker = { state?: string; accepting?: boolean; count?: number; received?: number; rejected?: number; lastResult?: string; acceptanceReason?: string };
export function TestDiagnosticStatus(props: { compact?: boolean }) {
  return SensorDiagnostics.available() ? <ActiveDiagnosticStatus {...props} /> : null;
}
function ActiveDiagnosticStatus({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<{ sensor: Sensor; marker: Marker } | null>(null);
  useFocusEffect(useCallback(() => {
    const read = () => { const next = SensorDiagnostics.status(); if (next) setData(next); };
    read(); const timer = setInterval(read, 1000); return () => clearInterval(timer);
  }, []));
  if (!data) return null;
  const { sensor: s, marker: m } = data;
  if (compact && !s.warning && !s.auditFailure && s.state === 'OFF' && (!m.state || m.state === 'OFF')) return null;
  const hz = (n?: number) => n == null ? '—' : n.toFixed(1);
  const age = (n?: number) => n == null ? '未受信' : `${(n / 1000).toFixed(1)}秒前`;
  return <View style={styles.box}>
    <Text style={styles.text}>Test採取確認：{s.displayState ?? s.state ?? '確認中'}</Text>
    <Text style={styles.text}>加速度 {s.accel?.count ?? 0}件 / {hz(s.accel?.actualHz)}Hz ・ ジャイロ {s.gyro?.count ?? 0}件 / {hz(s.gyro?.actualHz)}Hz</Text>
    {!compact && <Text style={styles.text}>最終受信：加速度 {age(s.accelLastReceivedAgoMs)} / ジャイロ {age(s.gyroLastReceivedAgoMs)}</Text>}
    <Text style={m.accepting ? styles.text : styles.warning}>マーカー {m.accepting ? '受付可能' : '受付不可'}：保存{m.count ?? 0}件 / 拒否{m.rejected ?? 0}件</Text>
    {!compact && <Text style={styles.text}>受信{m.received ?? 0}件 / 最終結果 {m.lastResult ?? 'なし'} / {m.acceptanceReason ?? '確認中'}</Text>}
    {!compact && <Text style={styles.text}>GPS診断：{DetectorJournal.status} / 診断終了理由：{s.endReason || 'なし'}</Text>}
    {(!compact || !s.notificationsAllowed) && <Text style={s.notificationsAllowed ? styles.text : styles.warning}>警告通知：{s.notificationsAllowed ? 'ON（無音）' : 'OFF（画面内警告のみ）'}</Text>}
    {!!s.warning && <Text accessibilityRole="alert" style={styles.warning}>{s.warning}</Text>}
    {!!s.auditFailure && <Text accessibilityRole="alert" style={styles.warning}>診断ログの保存失敗：{s.auditFailure}。検証成功とは扱えません。</Text>}
    {compact && <Pressable accessibilityRole="button" onPress={() => router.push('/sensor-diagnostics')}><Text style={styles.link}>採取状態の詳細を開く</Text></Pressable>}
  </View>;
}
const styles = StyleSheet.create({ box: { padding: 10, backgroundColor: '#23333b', gap: 4, width: '100%' },
  text: { color: '#e7f5ff', fontSize: 14 }, warning: { color: '#ffbaad', fontSize: 15 }, link: { color: '#8cdbff', paddingVertical: 5 } });
