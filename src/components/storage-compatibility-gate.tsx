import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { migrateLegacyStorage, needsCompatibilityCheck, prepareStorage, retryStorageCheck, type CompatibilityState } from '../repositories/storage-compatibility';

/** Before mounting tabs: no settings defaults, RUN recovery, or trash-retention reads. */
export function StorageCompatibilityGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CompatibilityState | null>(() => needsCompatibilityCheck() ? null : { status: 'READY' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void prepareStorage().then(next => { if (alive) setState(next); }); return () => { alive = false; }; }, []);
  if (state?.status === 'READY') return children;
  const run = async (action: () => Promise<CompatibilityState>) => {
    setBusy(true); try { setState(await action()); } finally { setBusy(false); }
  };
  const confirm = () => Alert.alert('旧データを保持してSQLiteへコピー',
    '履歴・GPS・ごみ箱・設定・未保存RUNを照合してコピーします。旧データは削除しません。移行先に既存データがある場合や照合できない場合は中止します。',
    [{ text: '今はしない', style: 'cancel' }, { text: '確認してコピー', onPress: () => { void run(migrateLegacyStorage); } }]);
  return <View style={{ flex: 1, backgroundColor: '#111418', padding: 28, justifyContent: 'center', gap: 20 }}>
    <Text style={{ color: '#fff', fontSize: 22 }}>保存データの互換確認</Text>
    {!state || busy ? <ActivityIndicator color="#E85D2A" /> : <>
      <Text style={{ color: '#fff', fontSize: 16 }}>{state.status === 'FAILED' ? state.message : `旧形式のデータが${state.keys}項目見つかりました。確認が済むまで計測・履歴・設定の更新を停止しています。`}</Text>
      {state.status === 'MIGRATION_REQUIRED' && <Pressable accessibilityRole="button" onPress={confirm} style={{ padding: 16, backgroundColor: '#A43A15' }}><Text style={{ color: '#fff' }}>旧データのコピーを確認する</Text></Pressable>}
      <Pressable accessibilityRole="button" onPress={() => { void run(retryStorageCheck); }} style={{ padding: 16 }}><Text style={{ color: '#fff' }}>再確認</Text></Pressable>
    </>}
  </View>;
}
