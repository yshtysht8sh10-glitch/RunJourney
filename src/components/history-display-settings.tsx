import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { HistoryDisplaySettings, type HistoryTimeDisplay } from '@/repositories/history-display';

export function HistoryDisplaySettingsPanel() {
  const [value, setValue] = useState<HistoryTimeDisplay>('timestamps');
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setValue(await HistoryDisplaySettings.get()); setFailed(false); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (elapsed: boolean) => {
    setBusy(true);
    try { const next = elapsed ? 'elapsed' : 'timestamps'; await HistoryDisplaySettings.save(next); setValue(next); }
    catch (error) { Alert.alert('履歴表示を保存できませんでした', String(error)); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 12, paddingVertical: 20 }}>
    <Text style={{ color: '#F5F2EB', fontSize: 18 }}>履歴の時刻表示</Text>
    <Switch accessibilityLabel="履歴を経過時間で表示" disabled={busy || failed} value={value === 'elapsed'} onValueChange={enabled => void save(enabled)} />
    <Text style={{ color: '#A6A7A9' }}>OFF：開始・終了時刻（初期値）。ON：開始から終了までの経過時間。休憩・自動停止を含み、実走時間とは別です。保存済みの日時は変更しません。</Text>
    {failed && <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={{ color: '#F5F2EB' }}>表示設定を読み込めませんでした。再試行</Text></Pressable>}
  </View>;
}
