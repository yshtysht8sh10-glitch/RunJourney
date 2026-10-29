import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { PaceSettingsRepository } from '@/repositories/pace-settings';
import { formatWorkoutPace, PaceSettings } from '@/domain/pace-workout';
import { AdaptiveAudio } from '@/services/adaptive-audio';
export function StartSettingsSummary() {
  const [pace, setPace] = useState<PaceSettings | null>(null), [noise, setNoise] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => {
    let live = true;
    void Promise.all([PaceSettingsRepository.get(), AdaptiveAudio.enabled()]).then(([p,n])=>{if(live){setPace(p);setNoise(n);}});
    return ()=>{live=false;};
  }, []));
  return <View style={{width:'100%',padding:14,borderWidth:1,borderColor:'#33424C',borderRadius:12,marginBottom:16}}>
    <Text style={{color:'#F5F2EB',lineHeight:24}}>次のSTARTに適用する保存済み設定</Text>
    <Text style={{color:'#A6A7A9',lineHeight:23}}>{!pace ? '読込中…' : pace.enabled ? `ペース走 ${pace.distanceKm}km / ${formatWorkoutPace(pace.paceSecPerKm)} /km / 許容±${pace.toleranceSecPerKm}秒\nペース音声 ${pace.voice ? `ON・最小${pace.voiceIntervalSec}秒間隔（状態により省略）` : 'OFF'}` : 'ペース走 OFF'}{`\n騒音連動音量 ${noise===null ? '読込中' : noise ? 'ON（マイク状態は診断で確認）' : 'OFF'}`}</Text>
  </View>;
}
