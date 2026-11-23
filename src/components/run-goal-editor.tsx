import { useState } from 'react';
import { Alert, Pressable, Switch, Text, TextInput, View } from 'react-native';
import type { ActiveRun } from '@/types/run';
import type { FinishGoal } from '@/domain/finish-goal';
import { RunService } from '@/services/run-service';
export function RunGoalEditor({run,onSaved}: {run: ActiveRun; onSaved: (r: ActiveRun) => void}) {
 const [editing,setEditing]=useState(false),[kind,setKind]=useState<'distance'|'time'>('distance'),[value,setValue]=useState(''),[auto,setAuto]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState('');
 const open=()=>{ const target=run.paceWorkout?.workout.segments[0]?.target; const g=run.finishGoal?.kind!=='manual' ? run.finishGoal : target?.type==='distance'?{kind:'distance' as const,meters:target.meters}:target?.type==='duration'?{kind:'time' as const,activeMs:target.seconds*1000}:undefined; setKind(g?.kind==='time'?'time':'distance'); setValue(g?.kind==='distance'?String(g.meters/1000):g?.kind==='time'?String(g.activeMs/60000):''); setAuto(!!run.finishGoal && run.finishGoal.kind!=='manual' && run.finishAutoEnabled!==false); setResult('');setEditing(true); };
 const save=()=>{
  const goal: FinishGoal=kind==='distance'?{kind,meters:Number(value)*1000}:{kind,activeMs:Number(value)*60000};
  Alert.alert('目標変更を適用',`${kind==='distance'?`${value}km`:`${value}分`}・目標到達時の自動終了${auto?'ON':'OFF'}を保存します。`,[{text:'編集に戻る',style:'cancel'},{text:'保存して適用',onPress:()=>{setBusy(true);void RunService.updateFinishGoal(run.id,goal,auto).then(r=>{onSaved(r);setEditing(false);setResult('保存・適用しました');}).catch(e=>setResult(String(e.message??e))).finally(()=>setBusy(false));}}]);
 };
 const g=run.finishGoal;
 return <View style={{width:'100%',gap:12,marginVertical:20}}>
  <Text style={{color:'#F5F2EB'}}>このRUNの終了目標：{g?.kind==='distance'?`${g.meters/1000}km`:g?.kind==='time'?`${g.activeMs/60000}分`:'手動'} / 自動終了 {g && g.kind!=='manual' && run.finishAutoEnabled!==false?'ON':'OFF'}</Text>
  {!editing?<Pressable accessibilityRole="button" onPress={open} style={{padding:16,backgroundColor:'#33424C'}}><Text style={{color:'#FFF'}}>RUN中の目標を変更</Text></Pressable>:<>
   <Text style={{color:'#A6A7A9'}}>適用までは現在の目標で計測を続けます。到達済み目標で自動終了ONは保存できません。時間は停止・休憩を除く実走時間です。ペース走がある場合は到達目標も更新し、目標ペースは保持します。</Text>
   {(['distance','time'] as const).map(k=><Pressable key={k} disabled={busy} accessibilityRole="radio" accessibilityState={{checked:kind===k}} onPress={()=>{setKind(k);setValue('');}} style={{padding:14,borderWidth:1,borderColor:kind===k?'#E85D2A':'#777'}}><Text style={{color:'#FFF'}}>{k==='distance'?'目標距離':'目標時間'}</Text></Pressable>)}
   <TextInput accessibilityLabel="RUN中の目標値" keyboardType="decimal-pad" value={value} editable={!busy} onChangeText={setValue} placeholder={kind==='distance'?'km':'分'} placeholderTextColor="#AAA" style={{minHeight:52,padding:12,color:'#FFF',borderWidth:1,borderColor:'#777'}} />
   <Text style={{color:'#FFF'}}>目標達成時の自動終了</Text><Switch accessibilityLabel="目標達成時の自動終了" disabled={busy} value={auto} onValueChange={setAuto}/>
   <Pressable disabled={busy} onPress={save} style={{padding:16,backgroundColor:'#E85D2A'}}><Text style={{color:'#FFF'}}>{busy?'保存中…':'変更内容を確認'}</Text></Pressable>
   <Pressable disabled={busy} onPress={()=>setEditing(false)} style={{padding:16}}><Text style={{color:'#FFF'}}>変更を取り消す</Text></Pressable>
  </>}
  {!!result&&<Text accessibilityRole="alert" style={{color:'#F5F2EB'}}>{result}</Text>}
 </View>;
}
