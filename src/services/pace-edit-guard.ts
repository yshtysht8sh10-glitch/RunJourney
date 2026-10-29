import { Alert } from 'react-native';
type Binding = { dirty: boolean; save: () => Promise<void>; discard: () => void };
let binding: Binding | undefined;
let prompting = false;
export function bindPaceEditor(value: Binding) { binding = value; return () => { if(binding === value) binding = undefined; }; }
/** Returns true when navigation was intercepted. Success is required before replay. */
export function requestPaceLeave(action: () => void): boolean {
  if (!binding?.dirty) { action(); return false; }
  if (prompting) return true;
  const current = binding; prompting = true;
  const proceed = () => { if(binding === current) binding = undefined; prompting = false; action(); };
  Alert.alert('ペース走の変更が未保存です', '次のSTARTには保存済みの設定が使われます。', [
    { text: '編集に戻る', style: 'cancel', onPress: () => { prompting = false; } },
    { text: '破棄して移動', style: 'destructive', onPress: () => { current.discard(); proceed(); } },
    { text: '保存して移動', onPress: () => { void current.save().then(proceed).catch(() => { prompting = false; }); } },
  ], { cancelable: false });
  return true;
}
export function paceEditorDirty() { return !!binding?.dirty; }
