import { Text, View } from 'react-native';
import type { summarizeGroup } from '@/domain/history-groups';
export function HistoryGroupCard({ value }: { value: ReturnType<typeof summarizeGroup> }) {
  const km = (v: number | null) => v === null ? '推定不可' : `${(v/1000).toFixed(3)}km`;
  const time = (v: number | null) => v === null ? '推定不可' : `${(v/60000).toFixed(2)}分`;
  return <View style={{padding:14,gap:6,borderWidth:1,borderColor:'#A4D8B5',borderRadius:12}}>
    <Text style={{color:'#A4D8B5',fontSize:19}}>表示グループ · {value.memberIds.length} RUN</Text>
    <Text style={{color:'#F5F2EB'}}>{new Date(value.startedAt).toLocaleString('ja-JP')} → {new Date(value.endedAt).toLocaleTimeString('ja-JP')}</Text>
    <Text style={{color:'#F5F2EB'}}>記録距離 {km(value.recordedDistanceMeters)} / 実走 {time(value.recordedRunningMs)}</Text>
    <Text style={{color:'#F5F2EB'}}>空白の推定 {km(value.estimatedDistanceMeters)} / 推定走行 {time(value.estimatedRunningMs)}</Text>
    {value.unknownDistanceGaps>0 && <Text style={{color:'#F5F2EB'}}>推定可能分込み {km(value.recordedDistanceMeters+value.knownEstimatedDistanceMeters)} ＋ 推定不可{value.unknownDistanceGaps}区間（全距離は不明）</Text>}
    <Text style={{color:'#F5F2EB'}}>推定込み表示 {km(value.displayDistanceMeters)} / {time(value.displayRunningMs)}</Text>
    <Text style={{color:'#A6A7A9'}}>全経過 {time(value.wallClockMs)}。補間は端点間の直線モデルで、実際の経路・連続移動の証明ではありません。ランキング用は記録距離だけ。</Text>
    {value.gaps.map((g,i)=><Text key={i} style={{color:'#A6A7A9'}}>空白{i+1}：{(g.gapMs/1000).toFixed(1)}秒 / {km(g.estimatedDistanceMeters)} / {time(g.estimatedRunningMs)} · {g.reason}</Text>)}
  </View>;
}
