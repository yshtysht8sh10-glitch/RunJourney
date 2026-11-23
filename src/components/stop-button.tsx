import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { RUN_CONTROL } from '@/utils/run-model';
import { StopHold } from '@/utils/stop-hold';
import { completionLog } from '@/services/completion-log';
export function StopButton({ disabled, onStop }: { disabled: boolean; onStop: () => void }) {
  const hold = useRef(new StopHold());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('■ 長押しで終了');
  const latest = useRef({ disabled, onStop });
  useLayoutEffect(() => { latest.current = { disabled, onStop }; }, [disabled, onStop]);
  const cancel = () => { hold.current.cancel(); if (timer.current) clearInterval(timer.current); timer.current = null; setProgress(0); };
  const tick = () => {
    if (latest.current.disabled) { cancel(); return; }
    const now = Date.now();
    if (hold.current.complete(now)) {
      completionLog('HOLD_THRESHOLD');
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setProgress(1); setLabel('保存中…'); latest.current.onStop();
    } else setProgress(hold.current.progress(now));
  };
  useEffect(() => {
    if (disabled) { hold.current.cancel(); if (timer.current) clearInterval(timer.current); timer.current = null; }
  }, [disabled]);
  useEffect(() => {
    const controller = hold.current;
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') { hold.current.cancel(); if (timer.current) clearInterval(timer.current); timer.current = null; setProgress(0); } });
    return () => { sub.remove(); controller.cancel(); if (timer.current) clearInterval(timer.current); };
  }, []);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${RUN_CONTROL.holdMs / 1000}秒長押しで終了`} disabled={disabled}
    delayLongPress={RUN_CONTROL.holdMs}
    onPressIn={() => { if (latest.current.disabled) return; cancel(); completionLog('HOLD_STARTED'); hold.current.begin(Date.now()); setLabel('押し続けると終了'); timer.current = setInterval(tick, 30); }}
    onPressOut={() => { completionLog('HOLD_RELEASED'); cancel(); setLabel('■ 長押しで終了'); }}
    onLongPress={tick}
    style={{ width: '100%', minHeight: 64, overflow: 'hidden', borderRadius: 20, borderWidth: 2, borderColor: '#E85D2A', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, backgroundColor: '#763018' }} />
    <Text style={{ color: '#F5F2EB', fontSize: 18, fontWeight: '800' }}>{disabled ? '保存中…' : label}</Text>
  </Pressable>;
}
