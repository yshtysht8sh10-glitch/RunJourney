import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { AdaptiveAudio } from '@/services/adaptive-audio';
import { RunService } from '@/services/run-service';

export function NoiseVolumeSettings() {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { void AdaptiveAudio.enabled().then(setEnabled); }, []);
  const change = async (value: boolean) => {
    setBusy(true);
    try {
      if (!await AdaptiveAudio.setEnabled(value)) { Alert.alert('通常の音声案内を継続します', 'マイクが許可されなかったため、自動調整はOFFのままです。'); return; }
      setEnabled(value);
      if (value) { const run = await RunService.getActiveRun(); if (run && !run.endedAt) await AdaptiveAudio.start(run.id, !!run.paceWorkout?.voice); }
    } catch (error) { Alert.alert('自動音量調整を利用できません', String(error)); }
    finally { setBusy(false); }
  };
  return <View style={{ paddingVertical: 20, borderBottomWidth: 1, borderColor: '#30343A' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ color: '#F5F2EB', fontSize: 18, flex: 1 }}>騒音に合わせた音量調整（試験）</Text>
      <Switch value={enabled} disabled={busy} onValueChange={change} />
    </View>
    <Text style={{ color: '#A6A7A9', lineHeight: 21, marginTop: 10 }}>初期OFF。走行中は端末マイクを使い、音声は保存・送信しません。イヤホン向けです。静かな時の音量を抑え、騒音時に端末の設定音量まで滑らかに戻します。端末音量を超える増幅はしません。スピーカー再生中は自己音声の影響を避けるため調整を保留します。電池消費が増えます。</Text>
    {enabled && <Pressable accessibilityRole="button" disabled={busy} style={{ paddingVertical: 18 }} onPress={() => {
      void AdaptiveAudio.preview().then(status => {
        if (status !== 'STARTING') Alert.alert('測定を開始できませんでした', '画面を開いた状態とマイク権限を確認してください。通常の音声案内は継続します。');
      }).catch(error => Alert.alert('テストできませんでした', String(error)));
    }}><Text style={{ color: '#A4D8B5', fontSize: 16 }}>20秒間の音量追従テスト（履歴は作成しません）</Text></Pressable>}
  </View>;
}
