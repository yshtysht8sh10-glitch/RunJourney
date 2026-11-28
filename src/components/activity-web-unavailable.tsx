import { Link } from 'expo-router';
import { Text, View } from 'react-native';
export default function ActivityWebUnavailable() {
  return <View style={{ padding: 24 }}><Text>この運動計測機能はAndroid Test版で検証中です。Webの既存分析機能は引き続き利用できます。</Text><Link href="/">分析画面へ</Link></View>;
}
