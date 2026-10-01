import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RunService } from '@/services/run-service';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { DEFAULT_VOICE_ITEMS, VoiceItems } from '@/utils/voice-format';

export default function SettingsScreen() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<VoiceItems>(DEFAULT_VOICE_ITEMS);

  useFocusEffect(useCallback(() => {
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

  const labels: Record<keyof VoiceItems, string> = {
    elapsed: '総経過時間', totalDistance: '総走行距離', lapDistance: '直近ラップ距離',
    pace: '1kmペース', speed: '時速', marathon: 'フルマラソン換算',
  };

  return <View style={styles.background}><SafeAreaView style={styles.container}><ScrollView>
    <Text style={styles.title}>設定</Text>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled: busy }} onPress={() => change(!enabled)} style={styles.row}>
      <View style={styles.copy}><Text style={styles.label}>音声通知</Text>
        <Text style={styles.detail}>記録中、5分ごとに経過時間と距離を読み上げます</Text></View>
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
