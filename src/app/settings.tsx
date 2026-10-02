import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RunSettings, DEFAULT_RUN_FEATURES, RunFeatures } from '@/repositories/run-settings';
import { RunService } from '@/services/run-service';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { DEFAULT_VOICE_ITEMS, VoiceItems } from '@/utils/voice-format';
import { isStandaloneTest } from '@/utils/build';

export default function SettingsScreen() {
  const [features, setFeatures] = useState(DEFAULT_RUN_FEATURES);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<VoiceItems>(DEFAULT_VOICE_ITEMS);

  useFocusEffect(useCallback(() => {
    RunSettings.get().then(setFeatures).catch(() => undefined);
    VoiceAnnouncement.enabled().then(setEnabled).catch(() => undefined);
    VoiceAnnouncement.items().then(setItems).catch(() => undefined);
  }, []));

  const change = async (value: boolean) => {
    setBusy(true);
    try {
      await VoiceAnnouncement.setEnabled(value, await RunService.getActiveRun());
      setEnabled(value);
    } catch (error) {
      Alert.alert('設定を保存できませんでした', String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = async (key: keyof VoiceItems) => {
    const next = { ...items, [key]: !items[key] };
    setItems(next);
    try { await VoiceAnnouncement.setItems(next); }
    catch (error) { setItems(items); Alert.alert('設定を保存できませんでした', String(error)); }
  };

  const changeFeature = async (key: keyof RunFeatures, value: boolean) => {
    setBusy(true);
    try { const next = { ...features, [key]: value }; await RunSettings.save(next); setFeatures(next); }
    catch (error) { Alert.alert('設定を保存できませんでした', String(error)); }
    finally { setBusy(false); }
  };

  const labels: Record<keyof VoiceItems, string> = {
    elapsed: '走行時間', totalDistance: '総走行距離', lapDistance: '直近ラップ距離',
    pace: '1kmペース', speed: '時速', marathon: 'フルマラソン換算',
  };

  return <View style={styles.background}><SafeAreaView style={styles.container}><ScrollView>
    <Text style={styles.title}>設定</Text>
    <Text style={styles.section}>走行中の機能（次のSTARTから適用）</Text>
    <View style={styles.row}><View style={styles.copy}><Text style={styles.label}>自動停止（Auto Stop）</Text><Text style={styles.detail}>信号待ちなどで停止すると、走行時計を自動的に停止します。走り出すと自動的に再開します。</Text></View><Switch value={features.autoStop} disabled={busy} onValueChange={value => changeFeature('autoStop', value)} /></View>
    <View style={styles.row}><View style={styles.copy}><Text style={styles.label}>休憩（Break）</Text><Text style={styles.detail}>走行中に休憩ボタンを表示します。自分の意思で休憩を開始・終了できます。</Text></View><Switch value={features.break} disabled={busy} onValueChange={value => changeFeature('break', value)} /></View>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled: busy }} onPress={() => change(!enabled)} style={styles.row}>
      <View style={styles.copy}><Text style={styles.label}>音声通知</Text>
        <Text style={styles.detail}>記録中、走行時間の5分ごとに時間と距離を読み上げます</Text></View>
      <Switch value={enabled} disabled={busy} onValueChange={change} />
    </Pressable>
    <Text style={styles.section}>読み上げ内容</Text>
    {(Object.keys(labels) as (keyof VoiceItems)[]).map((key) =>
      <View key={key} style={styles.row}>
        <Text style={[styles.label, styles.copy]}>{labels[key]}</Text>
        <Switch value={items[key]} onValueChange={() => toggleItem(key)} />
      </View>)}
    <Pressable accessibilityRole="button" onPress={() => VoiceAnnouncement.test().catch((error) => Alert.alert('音声テストに失敗しました', String(error)))} style={styles.testButton}>
      <Text style={styles.label}>音声通知をテスト</Text>
    </Pressable>
    {isStandaloneTest() && <Pressable accessibilityRole="button" onPress={() => router.push('/diagnostics')} style={styles.testButton}><Text style={styles.label}>Auto Stop Diagnostics（Test）</Text></Pressable>}
  </ScrollView></SafeAreaView></View>;
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#111418' },
  container: { flex: 1, paddingHorizontal: 24 },
  title: { color: '#F5F2EB', fontSize: 30, fontWeight: '700', marginTop: 28, marginBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#30343A', paddingVertical: 18 },
  copy: { flex: 1, paddingRight: 16 },
  label: { color: '#F5F2EB', fontSize: 18, fontWeight: '600' },
  detail: { color: '#A6A7A9', fontSize: 13, lineHeight: 19, marginTop: 7 },
  section: { color: '#A6A7A9', fontSize: 15, marginTop: 24, marginBottom: 4 },
  testButton: { backgroundColor: '#33424C', alignItems: 'center', padding: 18, borderRadius: 12, marginTop: 24 },
});
