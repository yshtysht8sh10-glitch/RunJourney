import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RunService } from '@/services/run-service';
import { RunRepository } from '@/repositories/run-repository';
import { recoveryAnalysis } from '@/domain/recovery-analysis';

export function RecoveryExperiment() {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof recoveryAnalysis> | null>(null), [error, setError] = useState('');
  const start = async () => {
    if (busy) return;
    if (enabled) { setEnabled(false); setResult(null); return; }
    setEnabled(true); setBusy(true); setError('');
    try {
      const rows = await RunService.getHistoryPage(1000);
      if (!rows.length) throw Error('記録がありません。');
      const summary = await RunRepository.pagedSource(rows[0].id).summary();
      if (summary.pointCount > 2048) throw Error('この実験では長大なRUNの分析を見送ります（GPS 2,048点まで）。');
      const run = await RunRepository.getRun(rows[0].id);
      if (!run || run.trashedAt) throw Error('対象記録を確認できません。');
      setResult(recoveryAnalysis(rows, run, rows.length < 1000));
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <View style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled: busy }} disabled={busy} onPress={() => void start()} style={{ minHeight: 48 }}>
      <Text style={{ color: '#A4D8B5', lineHeight: 24 }}>疲労・回復分析（実験）{enabled ? 'ON' : 'OFF'} · {busy ? '分析中…' : '初期OFF・設定は保存しません'}</Text>
    </Pressable>
    {enabled && <Text style={{ color: '#A6A7A9', lineHeight: 23 }}>端末内のルール・統計による観察です。外部AI送信・走行中の音声警告はありません。</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#FFB398' }}>{error}</Text>}
    {result && <>
      <Text style={{ color: '#F5F2EB', lineHeight: 24 }}>観測事実（最新RUN開始日の時点）</Text>
      {result.windows.map(w => <Text key={w.days} style={{color:'#F5F2EB',lineHeight:24}}>{w.days}日：{w.distanceKm.toFixed(2)}km・{Math.round(w.activeMinutes)}分 / 走行記録{w.recordedRunDays}日・記録なし{w.noRecordedRunDays ?? '不明'}日</Text>)}
      <Text style={{ color: '#F5F2EB', lineHeight: 24 }}>連続走行記録 {result.consecutiveRecordedDays}日 / 前半 {result.firstHalfSecPerKm?.toFixed(0) ?? '不明'}秒/km → 後半 {result.secondHalfSecPerKm?.toFixed(0) ?? '不明'}秒/km / 過去28日 {result.priorRuns}RUN・ペース中央値 {result.priorMedianSecPerKm?.toFixed(0) ?? 'データ不足'}秒/km</Text>
      <Text style={{ color: '#A6A7A9', lineHeight: 23 }}>品質：停止区間{result.quality.stopIntervals}件・精度不良/不明{result.quality.poorOrMissingAccuracyPoints}/{result.quality.gpsPoints}点・目標変更{result.quality.goalChanges}件。これらの影響がある場合は推定を控えます。</Text>
      <Text style={{ color: '#F5F2EB', lineHeight: 24 }}>推定・提案：{result.inference}</Text>
      <Text style={{ color: '#A6A7A9', lineHeight: 23 }}>{result.limitations}</Text>
    </>}
  </View>;
}
