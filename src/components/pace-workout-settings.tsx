import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { DEFAULT_PACE_SETTINGS, formatWorkoutPace, targetPaceSeconds, targetTimeSeconds, validPaceSettings } from '../domain/pace-workout';
import { PaceSettingsRepository } from '../repositories/pace-settings';

/** Text parsing deliberately rejects exponents, signs, blank, NaN and Infinity. */
export function parseWorkoutClock(text: string, hours = false): number {
  const pattern = hours ? /^\d{1,2}:[0-5]\d:[0-5]\d$/ : /^\d{1,2}:[0-5]\d$/;
  if (!pattern.test(text)) return NaN;
  return text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}
function clock(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
export default function PaceWorkoutSettings() {
  const [settings, setSettings] = useState(DEFAULT_PACE_SETTINGS);
  const [distance, setDistance] = useState('5');
  const [pace, setPace] = useState('6:15');
  const [canonicalPace, setCanonicalPace] = useState(375);
  const [duration, setDuration] = useState('0:31:15');
  const [tolerance, setTolerance] = useState('15');
  const [frequency, setFrequency] = useState('120');
  const [basis, setBasis] = useState<'pace' | 'time'>('pace');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let mounted = true;
    PaceSettingsRepository.get().then(s => {
      if (!mounted) return;
      setSettings(s); setDistance(String(s.distanceKm)); setPace(formatWorkoutPace(s.paceSecPerKm));
      setCanonicalPace(s.paceSecPerKm);
      setDuration(clock(targetTimeSeconds(s.distanceKm, s.paceSecPerKm)));
      setTolerance(String(s.toleranceSecPerKm)); setFrequency(String(s.voiceIntervalSec)); setLoaded(true);
    });
    return () => { mounted = false; };
  }, []);
  const numeric = (text: string) => /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
  const km = numeric(distance);
  const paceSeconds = basis === 'pace' ? canonicalPace : targetPaceSeconds(km, parseWorkoutClock(duration, true));
  const draft = { ...settings, distanceKm: km, paceSecPerKm: paceSeconds, toleranceSecPerKm: numeric(tolerance), voiceIntervalSec: numeric(frequency) };
  const valid = validPaceSettings(draft);
  const changeDistance = (text: string) => {
    setDistance(text); setSaved(false);
    const nextKm = numeric(text);
    if (basis === 'pace' && Number.isFinite(nextKm * paceSeconds)) setDuration(clock(nextKm * paceSeconds));
    if (basis === 'time' && nextKm > 0) setPace(formatWorkoutPace(parseWorkoutClock(duration, true) / nextKm));
  };
  const save = async () => {
    setBusy(true);
    try {
      // OFF remains available even while draft numeric fields contain an unfinished edit.
      const next = settings.enabled ? draft : { ...settings, ...(valid ? draft : {}), enabled: false };
      await PaceSettingsRepository.save(next); setSettings(next); setSaved(true);
    } catch (error) { Alert.alert('ペース走を保存できませんでした', String(error)); }
    finally { setBusy(false); }
  };
  const input = (label: string, value: string, onChangeText: (s: string) => void) => <View style={styles.field}>
    <Text style={styles.text}>{label}</Text><TextInput accessibilityLabel={label} value={value}
      onChangeText={text => { setSaved(false); onChangeText(text); }} editable={loaded && !busy}
      keyboardType={label.includes(':') ? 'default' : 'decimal-pad'} style={styles.input} selectTextOnFocus />
  </View>;
  return <View style={styles.panel}>
    <Text style={styles.title}>ペース走（次のSTARTから）</Text>
    <View style={styles.row}><Text style={styles.text}>一定ペース走</Text><Switch accessibilityLabel="一定ペース走" value={settings.enabled} disabled={!loaded || busy}
      onValueChange={enabled => { setSettings(s => ({ ...s, enabled })); setSaved(false); }} /></View>
    {settings.enabled && <>
      {input('目標距離（km）', distance, changeDistance)}
      {input('目標ペース（分:秒 /km）', pace, text => {
        setBasis('pace'); setPace(text); setCanonicalPace(parseWorkoutClock(text));
        const seconds = parseWorkoutClock(text);
        if (Number.isFinite(seconds * km)) setDuration(clock(seconds * km));
      })}
      {input('目標時間（時:分:秒）', duration, text => {
        setBasis('time'); setDuration(text);
        const seconds = parseWorkoutClock(text, true);
        if (Number.isFinite(seconds) && km > 0) setPace(formatWorkoutPace(seconds / km));
      })}
      <Text style={styles.note}>ペース・時間は最後に編集した値を基準に換算します。保存時は丸め前の値を使います。</Text>
      {valid && <Text style={styles.text}>目標 {formatWorkoutPace(paceSeconds)} /km · 時速 {(3600 / paceSeconds).toFixed(2)} km/h</Text>}
      {input('許容幅（±秒/km）', tolerance, setTolerance)}
      <View style={styles.row}><Text style={styles.text}>ペース走の音声案内</Text><Switch accessibilityLabel="ペース走の音声案内" value={settings.voice} disabled={busy}
        onValueChange={voice => { setSettings(s => ({ ...s, voice })); setSaved(false); }} /></View>
      {input('音声の最小間隔（秒・60〜600）', frequency, setFrequency)}
      <Text style={styles.note}>{Platform.OS === 'android' ? '音声は対応するAndroid開発ビルドで利用できます。通常の5分通知とは個別に設定します。' : 'この端末では画面表示で案内します。音声はAndroidに対応しています。'}目標に到達しても自動STOPしません。</Text>
      {!valid && <Text accessibilityRole="alert" style={styles.error}>距離0.1〜200km、ペース2〜30分/km、許容幅0〜120秒、通知60〜600秒、目標時間48時間以内で入力してください。</Text>}
    </>}
    <Pressable accessibilityRole="button" accessibilityLabel="ペース走設定を保存" disabled={!loaded || busy || settings.enabled && !valid} onPress={save} style={styles.button}>
      <Text style={styles.text}>{busy ? '保存中…' : 'ペース走設定を保存'}</Text>
    </Pressable>
    {saved && <Text accessibilityLiveRegion="polite" style={styles.note}>保存しました。次のSTARTから適用します。</Text>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { marginTop: 24, paddingVertical: 16, gap: 12, borderBottomWidth: 1, borderColor: '#30343A' },
  title: { color: '#F5F2EB', fontSize: 20, fontWeight: '700' }, text: { color: '#F5F2EB', fontSize: 16 },
  note: { color: '#A6A7A9', fontSize: 13, lineHeight: 20 }, error: { color: '#FFB49D', lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  field: { gap: 8 }, input: { color: '#F5F2EB', borderWidth: 1, borderColor: '#667178', borderRadius: 8, minHeight: 48, padding: 12, fontSize: 18 },
  button: { backgroundColor: '#33424C', padding: 16, borderRadius: 10, alignItems: 'center', minHeight: 48 },
});
