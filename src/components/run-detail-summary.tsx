import { StyleSheet, Text, View } from 'react-native';
import type { RunSummary } from '@/domain/pages';
import { analyzePace } from '@/utils/pace-analysis';
type Summary = Pick<RunSummary, 'startedAt' | 'endedAt' | 'distanceMeters' | 'activeRunningTime' | 'wallClockElapsed' | 'pointCount'>;
const duration = (ms: number) => Number.isFinite(ms) && ms >= 0 ? `${Math.floor(ms / 60000)}分${Math.floor(ms / 1000) % 60}秒` : '不明';
const date = (text: string) => Number.isFinite(Date.parse(text)) ? new Date(text).toLocaleString('ja-JP') : '不明';
export function RunDetailSummary({ summary }: { summary: Summary }) {
  const pace = analyzePace(0, summary.activeRunningTime, summary.distanceMeters);
  const seconds = pace.secondsPerKm === null || !Number.isFinite(pace.secondsPerKm) ? null : Math.round(pace.secondsPerKm);
  const speed = pace.kmPerHour !== null && Number.isFinite(pace.kmPerHour) ? pace.kmPerHour.toFixed(1) : '—';
  return <View testID="run-detail-summary" style={styles.panel}>
    <Text style={styles.label}>総走行距離</Text>
    <Text testID="detail-distance" style={styles.distance}>{Number.isFinite(summary.distanceMeters) && summary.distanceMeters >= 0 ? (summary.distanceMeters / 1000).toFixed(2) : '—'} km</Text>
    <View style={styles.metrics}>
      <Text testID="detail-pace" style={styles.metric}>平均ペース {seconds === null ? '—' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`} /km</Text>
      <Text testID="detail-speed" style={styles.metric}>平均時速 {speed} km/h</Text>
    </View>
    <Text style={styles.text}>実走時間 {duration(summary.activeRunningTime)}</Text>
    <Text style={styles.text}>全経過時間 {duration(summary.wallClockElapsed)}</Text>
    <Text style={styles.note}>実走時間は停止・休憩の扱いと訂正を反映。全経過は開始から終了までです。</Text>
    <Text testID="detail-start" style={styles.text}>開始日時 {date(summary.startedAt)}</Text>
    <Text testID="detail-end" style={styles.text}>終了日時 {date(summary.endedAt)}</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 10, paddingVertical: 16 }, label: { color: '#D9DBDE', fontSize: 16 },
  distance: { color: '#E8A975', fontSize: 40, fontWeight: '700', flexShrink: 1 },
  metrics: { gap: 10, flexDirection: 'row', flexWrap: 'wrap' }, metric: { color: '#F5F2EB', fontSize: 19, fontWeight: '600' },
  text: { color: '#F5F2EB', fontSize: 16, lineHeight: 26 }, note: { color: '#A6A7A9', fontSize: 14, lineHeight: 22 },
});
