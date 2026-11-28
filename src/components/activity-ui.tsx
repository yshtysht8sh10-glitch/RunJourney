import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
export const activityStyles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#111418' },
  content: { padding: 18, paddingBottom: 36, gap: 18 }, text: { color: '#F5F2EB', fontSize: 17 },
  title: { color: '#F5F2EB', fontSize: 27, fontWeight: '700' }, muted: { color: '#BFC5CC', fontSize: 15 },
  button: { minHeight: 52, padding: 15, borderRadius: 12, backgroundColor: '#33424C', justifyContent: 'center' },
  card: { backgroundColor: '#1D2329', padding: 16, borderRadius: 14, gap: 10 },
});
export function ActivityPage({ title, children }: { title: string; children: ReactNode }) {
  return <SafeAreaView style={activityStyles.screen} edges={['bottom']}><ScrollView contentContainerStyle={activityStyles.content}>
    <Text accessibilityRole="header" style={activityStyles.title}>{title}</Text>{children}
  </ScrollView></SafeAreaView>;
}
export function ActivityButton({ label, onPress, disabled = false, style }: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress}
    style={[activityStyles.button, style, disabled && { opacity: 0.45 }]}><Text style={activityStyles.text}>{label}</Text></Pressable>;
}
export function ActivityMetric({ label, value }: { label: string; value: string }) {
  return <View style={activityStyles.card}><Text style={activityStyles.muted}>{label}</Text><Text style={{ ...activityStyles.title, fontSize: 36 }}>{value}</Text></View>;
}
export function activityDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0')).join(':');
}
