import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { RUN_CONTROL } from '@/utils/run-model';
import { StopHold } from '@/utils/stop-hold';
export function StopButton({ disabled, onStop }: { disabled: boolean; onStop: () => void }) {
  const hold = useRef(new StopHold());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('■ 長押しで終了');
  const cancel = () => { hold.current.cancel(); if (timer.current) clearInterval(timer.current); timer.current = null; setProgress(0); };
  useEffect(() => {
    const controller = hold.current;
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') { hold.current.cancel(); if (timer.current) clearInterval(timer.current); timer.current = null; setProgress(0); } });
    return () => { sub.remove(); controller.cancel(); if (timer.current) clearInterval(timer.current); };
  }, []);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${RUN_CONTROL.holdMs / 1000}秒長押しで終了`} disabled={disabled}
    delayLongPress={RUN_CONTROL.holdMs}
    onPressIn={() => { cancel(); hold.current.begin(Date.now()); setLabel('押し続けると終了'); timer.current = setInterval(() => setProgress(hold.current.progress(Date.now())), 30); }}
    onPressOut={() => { cancel(); setLabel('■ 長押しで終了'); }}
    onLongPress={() => { if (hold.current.complete(Date.now())) { cancel(); setLabel('保存中…'); onStop(); } }}
    style={{ width: '100%', minHeight: 64, overflow: 'hidden', borderRadius: 20, borderWidth: 2, borderColor: '#E85D2A', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, backgroundColor: '#763018' }} />
    <Text style={{ color: '#F5F2EB', fontSize: 18, fontWeight: '800' }}>{label}</Text>
  </Pressable>;
}
