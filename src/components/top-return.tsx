import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { paceEditorDirty, requestPaceLeave } from '@/services/pace-edit-guard';
export function TopReturn() {
  const leave = () => router.push('/top');
  return <SafeAreaView edges={['top']} style={{ backgroundColor: '#111418' }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Topに戻る。計測は継続します" style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 16 }}
      onPress={() => { if (paceEditorDirty()) requestPaceLeave(leave); else leave(); }}>
      <Text style={{ color: '#BFC5CC', fontSize: 14 }}>‹ Topに戻る</Text>
    </Pressable>
  </SafeAreaView>;
}
