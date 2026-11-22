import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Switch, Text, View } from 'react-native';
import { RecoverySettings as Settings } from '@/repositories/recovery-settings';
export function RecoverySettings(){
  const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false);
  useFocusEffect(useCallback(()=>{let live=true;void Settings.get().then(v=>{if(live)setEnabled(v);}).catch(e=>Alert.alert('設定を読み込めませんでした',String(e)));return()=>{live=false;};},[]));
  const change=async(v:boolean)=>{setBusy(true);try{await Settings.save(v);setEnabled(v);}catch(e){Alert.alert('設定を保存できませんでした',String(e));}finally{setBusy(false);}};
  return <View style={{padding:24,gap:12}}><View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={{flex:1,color:'#F5F2EB',fontSize:16}}>疲労・回復分析（実験）{enabled?'ON':'OFF'}</Text><Switch accessibilityLabel="疲労・回復分析" value={enabled} disabled={busy} onValueChange={v=>void change(v)}/></View><Text style={{color:'#A6A7A9',lineHeight:23}}>初期OFF。履歴に端末内の分析結果を表示します。外部AI送信・走行中の警告はありません。</Text></View>;
}
