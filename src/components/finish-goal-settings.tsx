import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { FinishSettings } from '../repositories/finish-settings';
import type { FinishGoal } from '../domain/finish-goal';

export function FinishGoalSettings({ onReady }: { onReady: (ready: boolean) => void }) {
  const [kind, setKind] = useState<FinishGoal['kind']>('manual');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);
  useEffect(() => {
    let mounted = true;
    FinishSettings.get().then(g => { if (mounted) { setKind(g.kind); setValue(g.kind === 'distance' ? String(g.meters / 1000) : g.kind === 'time' ? String(g.activeMs / 60000) : ''); onReady(true); } })
      .catch(() => { if (mounted) setError('終了条件を読み込めませんでした。手動終了を選び直してください。'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [onReady]);
  const change = async (nextKind: FinishGoal['kind'], text: string) => {
    const current = ++revision.current;
    setKind(nextKind); setValue(text); onReady(false); setError('');
    const number = Number(text);
    const goal: FinishGoal = nextKind === 'manual' ? { kind: 'manual' } : nextKind === 'distance' ? { kind: 'distance', meters: number * 1000 } : { kind: 'time', activeMs: number * 60000 };
    try { await FinishSettings.save(goal); if (current === revision.current) onReady(true); }
    catch (e) { if (current === revision.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  return <View style={{ width: '100%', gap: 10, marginVertical: 24 }}>
    <Text style={{ color: '#F5F2EB', fontSize: 18 }}>終了条件（ペース走の目標とは別設定）</Text>
    {(['manual', 'distance', 'time'] as const).map(k => <Pressable key={k} disabled={loading} accessibilityRole="radio" accessibilityState={{ checked: kind === k }} onPress={() => void change(k, k === kind ? value : '')} style={{ padding: 12, borderWidth: 1, borderColor: kind === k ? '#E85D2A' : '#777B80', borderRadius: 8 }}>
      <Text style={{ color: '#F5F2EB' }}>{k === 'manual' ? '手動終了のみ' : k === 'distance' ? '目標距離に到達したら終了' : '目標時間に到達したら終了'}</Text>
    </Pressable>)}
    {kind !== 'manual' && <TextInput accessibilityLabel={kind === 'distance' ? '自動終了の距離（km）' : '自動終了の時間（分）'} keyboardType="decimal-pad" value={value} onChangeText={text => void change(kind, text)} placeholder={kind === 'distance' ? '距離（km）例：10' : '有効時間（分）例：60'} placeholderTextColor="#A6A7A9" style={{ padding: 14, color: '#F5F2EB', borderColor: '#777B80', borderWidth: 1, borderRadius: 8 }} />}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#FFB398' }}>{error}</Text>}
  </View>;
}
