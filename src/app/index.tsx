import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BuildInfo } from '@/components/build-info';
import { RunService } from '@/services/run-service';
import { ActiveRun } from '@/types/run';

function formatElapsed(startedAt: string, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function confirmPermissionExplanation(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true);
  return new Promise((resolve) => {
    Alert.alert(
      '位置情報の許可について',
      '画面をOFFにしても記録を続けるため、次の画面で位置情報を「常に許可」にしてください。記録中はAndroidの通知が表示されます。',
      [
        { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
        { text: '続ける', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export default function RunScreen() {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(true);

  const showError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : '処理に失敗しました。';
    Alert.alert('RunJourney', message);
  }, []);

  useEffect(() => {
    let mounted = true;
    RunService.restoreActiveRun()
      .then((run) => mounted && setActiveRun(run))
      .catch(showError)
      .finally(() => mounted && setBusy(false));

    const timer = setInterval(() => {
      setNow(Date.now());
      RunService.getActiveRun().then((run) => mounted && setActiveRun(run)).catch(() => undefined);
    }, 1_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [showError]);

  const start = async () => {
    if (!(await confirmPermissionExplanation())) return;
    setBusy(true);
    try {
      setActiveRun(await RunService.startRun());
      setNow(Date.now());
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const stop = () => {
    Alert.alert('ランニングを終了しますか？', '現在までの記録を履歴へ保存します。', [
      { text: '続ける', style: 'cancel' },
      {
        text: '終了して保存',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await RunService.stopRun();
            setActiveRun(null);
          } catch (error) {
            showError(error);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.background}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <Text style={styles.brand}>RUNJOURNEY</Text>
        <BuildInfo />
        <View style={styles.content}>
          {activeRun ? (
            <>
              <Text style={styles.eyebrow}>RUNNING</Text>
              <Text style={styles.distance}>{(activeRun.distanceMeters / 1000).toFixed(2)}</Text>
              <Text style={styles.unit}>km</Text>
              <Text style={styles.elapsed}>{formatElapsed(activeRun.startedAt, now)}</Text>
              <Text style={styles.status}>GPSポイント {activeRun.points.length}件を保存済み</Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={stop} style={({ pressed }) => [styles.stopButton, pressed && styles.pressed, busy && styles.disabled]}>
                <Text style={styles.stopButtonText}>STOP</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.readyTitle}>今日の一歩を{`\n`}記録しよう。</Text>
              <Text style={styles.description}>START後は画面をOFFにしても記録が続きます。位置情報は「常に許可」を選択してください。</Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={start} style={({ pressed }) => [styles.startButton, pressed && styles.pressed, busy && styles.disabled]}>
                <Text style={styles.startButtonText}>{busy ? '準備中…' : 'START'}</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#111418' },
  container: { flex: 1, paddingHorizontal: 24 },
  brand: { color: '#E85D2A', fontSize: 15, fontWeight: '800', letterSpacing: 2.5, marginTop: 14 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 50 },
  eyebrow: { color: '#E85D2A', fontSize: 16, fontWeight: '800', letterSpacing: 4, marginBottom: 24 },
  distance: { color: '#F5F2EB', fontSize: 92, fontWeight: '200', letterSpacing: -5, lineHeight: 100 },
  unit: { color: '#A6A7A9', fontSize: 24, fontWeight: '500', marginTop: -4 },
  elapsed: { color: '#F5F2EB', fontSize: 36, fontVariant: ['tabular-nums'], marginTop: 34 },
  status: { color: '#777B80', fontSize: 13, marginTop: 12, marginBottom: 48 },
  readyTitle: { color: '#F5F2EB', fontSize: 44, fontWeight: '700', lineHeight: 53, alignSelf: 'stretch' },
  description: { color: '#A6A7A9', fontSize: 16, lineHeight: 25, marginTop: 20, marginBottom: 50 },
  startButton: { width: 190, height: 190, borderRadius: 95, backgroundColor: '#E85D2A', alignItems: 'center', justifyContent: 'center' },
  startButtonText: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: 2 },
  stopButton: { width: 170, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#E85D2A', alignItems: 'center', justifyContent: 'center' },
  stopButtonText: { color: '#E85D2A', fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
