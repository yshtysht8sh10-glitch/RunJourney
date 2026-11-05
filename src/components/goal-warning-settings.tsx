import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { GoalWarningSettingsRepository } from '@/repositories/goal-warning-settings';
export function GoalWarningSettings() {
  const [distance,setDistance]=useState('500'),[seconds,setSeconds]=useState('60'),[ready,setReady]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{void GoalWarningSettingsRepository.get().then(v=>{setDistance(String(v.distanceMeters));setSeconds(String(v.timeSeconds));setReady(true);}).catch(e=>setMessage(String(e)));},[]);
  return <View style={{paddingVertical:16,gap:10}}>
    <Text style={{color:'#F5F2EB',fontSize:18}}>自動終了の予告</Text>
    <Text style={{color:'#A6A7A9'}}>自動終了ONの目標で1回案内します。目標変更が間に合う保証はありません。保存後の次の判定から適用。</Text>
    <Text style={{color:'#F5F2EB'}}>残り距離（50〜5000m）</Text>
    <TextInput accessibilityLabel="終了予告の距離m" value={distance} onChangeText={setDistance} keyboardType="numeric" style={{color:'#F5F2EB',borderWidth:1,borderColor:'#777B80',padding:12}} />
    <Text style={{color:'#F5F2EB'}}>残り時間（10〜600秒）</Text>
    <TextInput accessibilityLabel="終了予告の時間秒" value={seconds} onChangeText={setSeconds} keyboardType="numeric" style={{color:'#F5F2EB',borderWidth:1,borderColor:'#777B80',padding:12}} />
    <Pressable disabled={!ready} onPress={()=>void GoalWarningSettingsRepository.save({distanceMeters:Number(distance),timeSeconds:Number(seconds)}).then(()=>setMessage('保存しました')).catch(e=>setMessage(String(e)))} style={{minHeight:48,padding:12}}><Text style={{color:'#A4D8B5'}}>予告設定を保存</Text></Pressable>
    {!!message && <Text style={{color:'#FFB398'}}>{message}</Text>}
  </View>;
}
