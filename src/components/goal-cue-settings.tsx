import { useCallback,useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert,Switch,Text,View } from 'react-native';
import { GoalCueSettings } from '@/repositories/goal-cue-settings';
import { DEFAULT_CUES,type CueSettings } from '@/domain/goal-cues';
import { GoalCues } from '@/services/goal-cues';
import { RunRepository } from '@/repositories/run-repository';
export function GoalCueSettingsPanel(){
 const [value,setValue]=useState({...DEFAULT_CUES}),[busy,setBusy]=useState(false);
 useFocusEffect(useCallback(()=>{let live=true;void GoalCueSettings.get().then(v=>{if(live)setValue(v);}).catch(e=>Alert.alert('設定を読み込めませんでした',String(e)));return()=>{live=false;};},[]));
 const change=async(key:'turnaround'|'countdown',on:boolean)=>{setBusy(true);try{const next=await GoalCueSettings.save({...value,[key]:on});setValue(next);const run=await RunRepository.getActiveRun();if(run)await GoalCues.update(run);}catch(e){Alert.alert('設定を保存できませんでした',String(e));}finally{setBusy(false);}};
 return <View style={{padding:24,gap:16}}>{(['turnaround','countdown'] as const).map(key=><View key={key} style={{gap:8}}><View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={{flex:1,color:'#F5F2EB',fontSize:16}}>{key==='turnaround'?'折り返し案内':'終了前カウントダウン'} {value[key]?'ON':'OFF'}</Text><Switch accessibilityLabel={key==='turnaround'?'折り返し案内':'終了前カウントダウン'} value={value[key]} disabled={busy} onValueChange={v=>void change(key,v)}/></View><Text style={{color:'#A6A7A9',lineHeight:23}}>{description(key)}</Text></View>)}</View>;
}
function description(key:keyof Pick<CueSettings,'turnaround'|'countdown'>){return key==='turnaround'?'初期OFF。自動終了ONの目標の半分で案内します。往復の目安で、帰宅までの実距離や経路を保証する機能ではありません。変更時に半分を過ぎていれば過去の案内は読みません。':'初期OFF。自動終了前の残り200mから10m刻み、残り60秒から10秒刻み。開始時だけチャイム。GPSや再生遅延で数字を飛ばす場合があり、正確な位置・時刻は保証しません。停止中は読まず、再開時も過去の数字を追いかけません。同じ範囲の終了前予告より優先します。';}
