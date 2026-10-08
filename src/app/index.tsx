import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StopButton } from '@/components/stop-button';
import { stateOf, timeModel } from '@/utils/run-model';
import { analyzePace } from '@/utils/pace-analysis';
import { BuildInfo } from '@/components/build-info';
import { RunService } from '@/services/run-service';
import { ActiveRun } from '@/types/run';

function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
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
  const stopping = useRef(false);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(true);
  const [saveError, setSaveError] = useState('');

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

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true; setBusy(true);
    setSaveError('');
    try {
      const saved = await RunService.stopRun();
      if (!saved) throw new Error('保存された記録を確認できませんでした。履歴を確認してください。');
      setActiveRun(null);
      router.replace({ pathname: './run-summary', params: { id: saved.id } });
    }
    catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存に失敗しました。');
      setActiveRun(await RunService.getActiveRun().catch(() => activeRun));
    }
    finally { stopping.current = false; setBusy(false); }
  };
  const changeState = async () => {
    setBusy(true);
    try { setActiveRun(stateOf(activeRun!) === 'BREAK' ? await RunService.resumeRun() : await RunService.breakRun()); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  const time = activeRun ? timeModel(activeRun, now) : null;
  const pace = activeRun && time ? analyzePace(0, time.activeRunningTime, activeRun.distanceMeters).secondsPerKm : null;
  return (
    <View style={styles.background}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <Text style={styles.brand}>RUNJOURNEY</Text>
        <BuildInfo />
        <View style={styles.content}>
          {activeRun ? (
            <>
              <Text style={styles.eyebrow}>{stateOf(activeRun).replace('_', ' ')}</Text>
              <Text style={styles.distance}>{(activeRun.distanceMeters / 1000).toFixed(2)}</Text>
              <Text style={styles.unit}>km</Text>
              <Text style={styles.elapsed}>{formatElapsed(time!.activeRunningTime)}</Text>
              <Text style={styles.status}>{stateOf(activeRun) === 'AUTO_STOP' ? '停止しています。走り出すと自動再開' : stateOf(activeRun) === 'BREAK' ? `休憩中 ${formatElapsed(time!.breakDuration)}` : pace ? `${Math.floor(pace / 60)}:${String(Math.floor(pace % 60)).padStart(2, '0')} /km` : 'GPSを記録中'}</Text>
              {activeRun.features?.break && !activeRun.endedAt && <Pressable accessibilityRole="button" disabled={busy} onPress={changeState} style={{ width: '100%', minHeight: 64, borderRadius: 16, backgroundColor: '#33424C', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}><Text style={styles.startButtonText}>{stateOf(activeRun) === 'BREAK' ? '再 開' : '休 憩'}</Text></Pressable>}
              {saveError || activeRun.endedAt ? <View style={{ width: '100%' }}>
                <Text accessibilityRole="alert" style={styles.description}>{saveError || '終了した記録の保存が未完了です。'}</Text>
                <Pressable testID="retry-save" accessibilityRole="button" disabled={busy} onPress={stop} style={styles.startButton}><Text style={styles.startButtonText}>{busy ? '保存中…' : '保存を再試行'}</Text></Pressable>
              </View> : <StopButton disabled={busy} onStop={stop} />}
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
