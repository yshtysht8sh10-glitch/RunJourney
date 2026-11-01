import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { CLOCK_INTERVALS, ClockSettingsRepository, DEFAULT_CLOCK, type ClockSettings } from '@/repositories/clock-settings';
import { RunService } from '@/services/run-service';
import { VoiceAnnouncement } from '@/services/voice-announcement';
export function CurrentTimeSettings() {
  const [value, setValue] = useState(DEFAULT_CLOCK), [busy, setBusy] = useState(true);
  useEffect(() => { ClockSettingsRepository.get().then(setValue).catch(e => Alert.alert('設定読込失敗', String(e))).finally(() => setBusy(false)); }, []);
  const save = async (next: ClockSettings) => {
    setBusy(true);
    try { await ClockSettingsRepository.save(next); setValue(next); await VoiceAnnouncement.restore(await RunService.getActiveRun()); }
    catch (e) { Alert.alert('現在時刻の設定を適用できませんでした', String(e)); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 12, paddingVertical: 20 }}>
    <Text style={{ color: '#F5F2EB', fontSize: 18 }}>現在時刻の定期音声案内</Text>
    <Switch accessibilityLabel="現在時刻の音声案内" disabled={busy} value={value.enabled} onValueChange={enabled => void save({ ...value, enabled })} />
    <Text style={{ color: '#A6A7A9' }}>RUN開始からの経過時間基準。停止中・音声競合時は見送り、後追いしません。</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{CLOCK_INTERVALS.map(minutes => <Pressable key={minutes} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: value.minutes === minutes }} onPress={() => void save({ ...value, minutes })} style={{ minHeight: 48, padding: 14, borderWidth: 1, borderColor: value.minutes === minutes ? '#E85D2A' : '#777' }}><Text style={{ color: '#F5F2EB' }}>{minutes}分</Text></Pressable>)}</View>
  </View>;
}
