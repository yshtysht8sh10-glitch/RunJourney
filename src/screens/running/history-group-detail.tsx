import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HistoryGroupsRepository as Groups } from '@/repositories/history-groups';
import { HistoryGroupCard } from '@/components/history-group-card';
import type { summarizeGroup } from '@/domain/history-groups';
import { isStandaloneTest } from '@/utils/build';
export default function GroupDetail() {
  const { id }=useLocalSearchParams<{id:string}>();
  const [value,setValue]=useState<ReturnType<typeof summarizeGroup>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useFocusEffect(useCallback(()=>{let active=true;setValue(null);setError('');
    if(isStandaloneTest())void Groups.get().then(async gs=>{const g=gs.find(g=>g.id===id);if(!g)throw Error('グループがありません');const v=await Groups.preview(g.memberIds,g.continuous);if(active)setValue(v);}).catch(e=>{if(active)setError(String(e));});
    return()=>{active=false;};},[id]));
  const button=(text:string,press:()=>void)=><Pressable disabled={busy} onPress={press} accessibilityRole="button" style={{paddingVertical:16,minHeight:48}}><Text style={{color:'#A4D8B5',fontSize:16}}>{text}</Text></Pressable>;
  return <SafeAreaView style={{flex:1,backgroundColor:'#111418'}}><ScrollView contentContainerStyle={{padding:24}}>
    {button('‹ 履歴へ戻る',()=>router.replace('/history'))}
    <Text style={{color:'#F5F2EB',fontSize:25}}>グループ詳細</Text>
    {!!error&&<Text accessibilityRole="alert" style={{color:'#FFB398'}}>{error}</Text>}
    {value&&<><HistoryGroupCard value={value}/><Text style={{color:'#F5F2EB',marginTop:16}}>元のRUNはすべて残っています</Text>
      {value.memberIds.map((id,i)=><Pressable key={id} accessibilityRole="button" onPress={()=>router.push({pathname:'/run-detail',params:{id}})} style={{paddingVertical:16}}><Text style={{color:'#A4D8B5'}}>元RUN {i+1}の詳細 ›</Text></Pressable>)}
      {button('表示グループを解除',()=>Alert.alert('表示グループを解除','元RUNを変更せず、個別表示へ戻します。',[{text:'キャンセル'},{text:'解除',onPress:()=>{setBusy(true);void Groups.remove(id).then(()=>router.replace('/history')).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}]))}
    </>}
  </ScrollView></SafeAreaView>;
}
