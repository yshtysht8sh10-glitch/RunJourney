import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { TopSettingsRepository, type TopSettings } from '@/repositories/top-settings';
import { MeasurementOwnership, type MeasurementBinding } from '@/services/measurement-ownership';
import { MeasurementSessions } from '@/services/measurement-sessions';
type Environment = { settings: TopSettings; owner: MeasurementBinding | null; refresh: () => Promise<void> };
const Context = createContext<Environment | null>(null);
export function useActivityEnvironment() {
  const value = useContext(Context); if (!value) throw Error('計測の起動確認が完了していません'); return value;
}
const foreground = { color: '#F5F2EB', fontSize: 16 };
export function ActivityBootstrap({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<TopSettings | null>(null), [error, setError] = useState('');
  const read = useCallback(async () => {
    try { const value = await TopSettingsRepository.get(); setSettings(value); setError(''); }
    catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)); }
  }, []);
  useEffect(() => {
    let alive = true;
    void TopSettingsRepository.get().then(value => { if (alive) { setSettings(value); setError(''); } })
      .catch(failure => { if (alive) setError(String(failure instanceof Error ? failure.message : failure)); });
    return () => { alive = false; };
  }, []);
  // Evidence must be durable before the ordinary storage gate mounts.
  if (!settings) return <View style={{ flex: 1, backgroundColor: '#111418', padding: 28, justifyContent: 'center', gap: 20 }}>
    <Text style={foreground}>{error || '既存データとTOP設定を確認中…'}</Text>
    {!!error && <Pressable onPress={() => { void read(); }}><Text style={foreground}>元データを保持して再確認</Text></Pressable>}
  </View>;
  return children;
}
export function ActivityEnvironment({ children }: { children: ReactNode }) {
  const initialized = useRef(false);
  const [value, setValue] = useState<Omit<Environment, 'refresh'> | null>(null), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const [settings, state] = await Promise.all([TopSettingsRepository.get(), MeasurementOwnership.read()]);
    setValue({ settings, owner: state.binding }); setError('');
  }, []);
  const initialize = useCallback(async () => {
    try { await MeasurementSessions.reconcile(); initialized.current = true; await refresh(); }
    catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)); }
  }, [refresh]);
  useEffect(() => {
    let alive = true;
    void MeasurementSessions.reconcile().then(async () => {
      if (alive) { initialized.current = true; await refresh(); }
    }).catch(failure => { if (alive) setError(String(failure instanceof Error ? failure.message : failure)); });
    return () => { alive = false; };
  }, [refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && initialized.current) void refresh().catch(failure => setError(String(failure)));
    }); return () => sub.remove();
  }, [refresh]);
  if (!value) return <View style={{ flex: 1, backgroundColor: '#111418', padding: 28, justifyContent: 'center', gap: 20 }}>
    <Text style={foreground}>{error || '未終了記録と計測所有権を確認中…'}</Text>
    {!!error && <Pressable onPress={() => { void initialize(); }}><Text style={foreground}>削除・復元せず再確認</Text></Pressable>}
  </View>;
  // A refresh failure never unmounts an active measurement or resets ownership.
  return <Context.Provider value={{ ...value, refresh }}>
    {!!error && <Text style={{ ...foreground, backgroundColor: '#66301D' }}>状態を再確認できません。記録を保持しています：{error}</Text>}
    {children}
  </Context.Provider>;
}
