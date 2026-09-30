import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RunService } from '@/services/run-service';
import { VoiceAnnouncement } from '@/services/voice-announcement';

export default function SettingsScreen() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    VoiceAnnouncement.enabled().then(setEnabled).catch(() => undefined);
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

  return <View style={styles.background}><SafeAreaView style={styles.container}>
    <Text style={styles.title}>設定</Text>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled: busy }} onPress={() => change(!enabled)} style={styles.row}>
      <View style={styles.copy}><Text style={styles.label}>音声通知</Text>
        <Text style={styles.detail}>記録中、5分ごとに経過時間と距離を読み上げます</Text></View>
      <Switch value={enabled} disabled={busy} onValueChange={change} />
    </Pressable>
  </SafeAreaView></View>;
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#111418' },
  container: { flex: 1, paddingHorizontal: 24 },
  title: { color: '#F5F2EB', fontSize: 30, fontWeight: '700', marginTop: 28, marginBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#30343A', paddingVertical: 18 },
  copy: { flex: 1, paddingRight: 16 },
  label: { color: '#F5F2EB', fontSize: 18, fontWeight: '600' },
  detail: { color: '#A6A7A9', fontSize: 13, lineHeight: 19, marginTop: 7 },
});
