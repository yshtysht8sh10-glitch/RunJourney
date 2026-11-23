import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { RouteMapSettings } from '@/repositories/route-map-settings';
export function RouteMapSettingsPanel() {
  const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  const load=()=>RouteMapSettings.get().then(value=>{setEnabled(value);setReady(true);}).catch(()=>Alert.alert('地図設定を読み込めませんでした'));
  useEffect(()=>{void RouteMapSettings.get().then(value=>{setEnabled(value);setReady(true);}).catch(()=>undefined);},[]);
  const save=async(value:boolean)=>{setBusy(true);try{await RouteMapSettings.save(value);setEnabled(value);}catch{Alert.alert('地図設定を保存できませんでした');}finally{setBusy(false);}};
  return <View style={{gap:12,paddingVertical:20}}><Text style={{color:'#F5F2EB',fontSize:18}}>保存済みRUNの地図・軌跡</Text>
    <Switch accessibilityLabel="履歴の地図・軌跡を有効にする" disabled={!ready||busy} value={enabled} onValueChange={value=>void save(value)}/>
    <Text style={{color:'#A6A7A9'}}>初期OFF。ON時だけ走行詳細に地図の入口を表示します。軌跡は端末内で描画し、背景地図は別途許可した場合のみOpenStreetMapから取得します。</Text>
    {!ready&&<Pressable accessibilityRole="button" onPress={()=>void load()}><Text style={{color:'#F5F2EB',paddingVertical:14}}>地図設定を再読込み</Text></Pressable>}
  </View>;
}
