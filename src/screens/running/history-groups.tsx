import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Alert, FlatList, Pressable, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { RunService } from '@/services/run-service';
import { HistoryGroupsRepository as Groups } from '@/repositories/history-groups';
import type { HistoryGroup, summarizeGroup } from '@/domain/history-groups';
import type { RunHistoryItem } from '@/types/run';
import { HistoryGroupCard } from '@/components/history-group-card';
export default function HistoryGroups() {
  const [rows,setRows]=useState<RunHistoryItem[]>([]),[groups,setGroups]=useState<HistoryGroup[]>([]),[selected,setSelected]=useState<string[]>([]);
  const [preview,setPreview]=useState<ReturnType<typeof summarizeGroup>|null>(null),[continuous,setContinuous]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=useCallback(async()=>{try{const [r,g]=await Promise.all([RunService.getHistoryPage(1000),Groups.get()]);setRows(r);setGroups(g);setError('');}catch(e){setError(String(e));}},[]);
  useFocusEffect(useCallback(()=>{if(Application.applicationId==='app.runjourney.mobile.test')void load();},[load]));
  const work=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}};
  if(Application.applicationId!=='app.runjourney.mobile.test')return <Text>Test版専用です</Text>;
  const used=new Set(groups.flatMap(g=>g.memberIds));
  const button=(label:string,onPress:()=>void)=><Pressable disabled={busy} onPress={onPress} style={{minHeight:48,paddingVertical:12}}><Text style={{color:'#A4D8B5'}}>{label}</Text></Pressable>;
  return <SafeAreaView style={{flex:1,backgroundColor:'#111418'}}><FlatList contentContainerStyle={{padding:24,paddingBottom:48}} data={rows.filter(r=>!used.has(r.id))} keyExtractor={r=>r.id}
    ListHeaderComponent={<>
      {button('‹ 履歴へ戻る',()=>router.replace('/history'))}
      <Text style={{color:'#F5F2EB',fontSize:25}}>表示グループを作成・解除</Text>
      <Text style={{color:'#A6A7A9',lineHeight:24}}>元RUNは変更しません。隣接END→STARTは固定で0〜300秒。GPS不良時は補間を保留します。グループ設定はBackupに含み、クラウドRUN同期には含みません。</Text>
      {groups.map(g=><View key={g.id} style={{marginVertical:14}}><Text style={{color:'#F5F2EB'}}>グループ · {g.memberIds.length} RUN</Text>
        {button('内訳・補間を確認',()=>void work(async()=>setPreview(await Groups.preview(g.memberIds,g.continuous))))}
        {g.memberIds.map((id,i)=><View key={id}>{button(`元RUN ${i+1}の詳細`,()=>router.push({pathname:'/run-detail',params:{id}}))}</View>)}
        {button('表示グループを解除',()=>Alert.alert('表示グループを解除','元RUNは残し、個別表示へ戻します。',[{text:'キャンセル'},{text:'解除',onPress:()=>void work(async()=>{await Groups.remove(g.id);setPreview(null);await load();})}]))}
      </View>)}
      <Text style={{color:'#F5F2EB'}}>以下から2〜20 RUNを選択（最新1,000件まで）</Text>
      <View style={{flexDirection:'row',alignItems:'center'}}><Text style={{flex:1,color:'#F5F2EB'}}>空白でも走り続けたことを本人が確認済み</Text><Switch value={continuous} onValueChange={v=>{setContinuous(v);setPreview(null);}} disabled={busy}/></View>
      {button(`選択${selected.length}件のプレビュー`,()=>void work(async()=>setPreview(await Groups.preview(selected,continuous))))}
      {preview && <><HistoryGroupCard value={preview}/>{selected.length>1 && JSON.stringify([...selected].sort())===JSON.stringify([...preview.memberIds].sort()) && button('選択した元RUNを表示グループとして保存',()=>void work(async()=>{await Groups.create(selected,continuous);setSelected([]);setPreview(null);await load();}))}</>}
      {!!error && <Text accessibilityRole="alert" style={{color:'#FFB398'}}>{error}</Text>}
    </>}
    renderItem={({item})=><Pressable accessibilityRole="checkbox" accessibilityState={{checked:selected.includes(item.id)}} disabled={busy} onPress={()=>{setSelected(v=>v.includes(item.id)?v.filter(id=>id!==item.id):v.length<20?[...v,item.id]:v);setPreview(null);}} style={{paddingVertical:16,borderBottomWidth:1,borderColor:'#33424C'}}>
      <Text style={{color:selected.includes(item.id)?'#A4D8B5':'#F5F2EB'}}>{selected.includes(item.id)?'☑':'□'} {new Date(item.startedAt).toLocaleString('ja-JP')} · {(item.distanceMeters/1000).toFixed(2)}km</Text>
    </Pressable>}/></SafeAreaView>;
}
