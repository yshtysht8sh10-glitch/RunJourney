import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { PaceSettingsRepository } from '@/repositories/pace-settings';
import { formatWorkoutPace, PaceSettings } from '@/domain/pace-workout';
import { RunSettings } from '@/repositories/run-settings';
import { ClockSettingsRepository, ClockSettings } from '@/repositories/clock-settings';
import { VoiceAnnouncement } from '@/services/voice-announcement';
import { AdaptiveAudio } from '@/services/adaptive-audio';
export function StartSettingsSummary() {
  const [pace, setPace] = useState<PaceSettings | null>(null), [noise, setNoise] = useState<boolean | null>(null);
  const [extra, setExtra] = useState<{ autoStop: boolean; clock: ClockSettings; voice: boolean } | null>(null);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let live = true;
    void Promise.all([PaceSettingsRepository.get(), AdaptiveAudio.enabled(), RunSettings.get(), ClockSettingsRepository.get(), VoiceAnnouncement.enabled()]).then(([p,n,f,c,v])=>{if(live){setPace(p);setNoise(n);setExtra({autoStop:f.autoStop,clock:c,voice:v});setError('');}}).catch(()=>{if(live)setError('設定を読み込めませんでした。設定画面で確認してください。');});
    return ()=>{live=false;};
  }, []));
  return <View style={{width:'100%',padding:14,borderWidth:1,borderColor:'#33424C',borderRadius:12,marginBottom:16}}>
    <Text style={{color:'#F5F2EB',lineHeight:24}}>次のSTARTに適用する保存済み設定</Text>
    <Text style={{color:'#A6A7A9',lineHeight:23}}>{!pace ? '読込中…' : pace.enabled ? `ペース走 ${pace.distanceKm}km / ${formatWorkoutPace(pace.paceSecPerKm)} /km / 許容±${pace.toleranceSecPerKm}秒\nペース音声 ${pace.voice ? `ON・最小${pace.voiceIntervalSec}秒間隔（状態により省略）` : 'OFF'}` : 'ペース走 OFF'}{`\n騒音連動音量 ${noise===null ? '読込中' : noise ? 'ON' : 'OFF'}`}</Text>
    {extra && <Text style={{color:'#A6A7A9',lineHeight:23}}>Auto Stop {extra.autoStop ? 'ON' : 'OFF（自動停止しません）'}{'\n'}5分・距離音声 {extra.voice ? 'ON' : 'OFF'}{'\n'}現在時刻案内 {extra.clock.enabled ? `ON・${extra.clock.minutes}分間隔` : `OFF（保存間隔${extra.clock.minutes}分）`}</Text>}
    <Text style={{color:'#A6A7A9',lineHeight:23}}>{(() => { const raw = AdaptiveAudio.diagnostics(); let d: { microphoneGranted?: boolean; outputType?: number } | null = null; try { d = raw?.summary ? JSON.parse(raw.summary) : null; } catch { /* Status remains unknown. */ } return `マイク権限 ${d ? d.microphoneGranted ? '許可' : '未許可' : '取得不可'} / 出力先 ${d?.outputType ? `${({2:'本体スピーカー',3:'有線ヘッドセット',4:'有線ヘッドホン',8:'Bluetooth A2DP',22:'USBヘッドセット',26:'Bluetooth LE'} as Record<number,string>)[d.outputType] ?? 'その他'}（直近再生・開始後に再確認）` : '再生開始後に確認（未確定）'}`; })()}</Text>
    <Text style={{color:'#A6A7A9',lineHeight:23}}>目標達成時の自動終了：下の終了条件で確認・変更できます。手動終了のみ＝OFF。</Text>
    {!!error && <Text accessibilityRole="alert" style={{color:'#FFB398'}}>{error}</Text>}
  </View>;
}
