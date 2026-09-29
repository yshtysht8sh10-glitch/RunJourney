import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';

export function BuildInfo() {
  const hash = Constants.expoConfig?.extra?.buildGitHash;
  const buildId = Constants.expoConfig?.extra?.buildId;
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown';
  const versionCode = Application.nativeBuildVersion ?? 'unknown';

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Build: {__DEV__ ? 'Debug' : 'Release'}</Text>
      <Text style={styles.text}>v{version} ({versionCode}) · Build: {typeof hash === 'string' ? hash : 'unknown'}</Text>
      {typeof buildId === 'string' && buildId !== 'local' ? <Text style={styles.text}>EAS: {buildId.slice(0, 8)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 4 },
  text: { color: '#93979C', fontSize: 12, fontVariant: ['tabular-nums'] },
});
