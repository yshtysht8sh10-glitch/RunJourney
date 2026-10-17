import { CloudMode, configuredFirebase } from '../sync/firebase-config';
import { useState } from "react";
import { router } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { syncClient, firebasePagedTransport } from "../sync/firebase";
import { PagedSyncQueue } from "../sync/paged-protocol";
import { RunRepository } from "../repositories/run-repository";
import Storage from "../repositories/storage";
import { RunSummary } from "../domain/pages";

// Separate opt-in screen. Recording/STOP and production data paths never depend on sync.
export default function CloudSyncScreen() {
  const [mode, setMode] = useState<CloudMode>('production');
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [host, setHost] = useState("127.0.0.1");
  const [uid, setUid] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState<RunSummary[]>([]),
    [entries, setEntries] = useState<PagedSyncQueue["state"]>([]);
  const [queue, setQueue] = useState<PagedSyncQueue | null>(null);
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
      if (queue) setEntries(queue.state);
    }
  }
  async function login(create: boolean) {
    const client = syncClient(mode, host);
    const credential = await (create
      ? createUserWithEmailAndPassword(client.auth, email, password)
      : signInWithEmailAndPassword(client.auth, email, password));
    const owner = credential.user.uid,
      key = `@runjourney/sync/paged-v2/${mode}/${client.auth.app.options.projectId}/${owner}`;
    const next = new PagedSyncQueue(
      owner,
      {
        load: () => Storage.getItem(key),
        save: (value) => Storage.setItem(key, value),
      },
      RunRepository.pagedSource,
      firebasePagedTransport(client, owner),
    );
    await next.open();
    setQueue(next);
    setEntries(next.state);
    setUid(owner);
    setPreview([]);
    setMessage(
      `${mode === 'production' ? '本番Firebase' : 'Emulator'}にログインしました。送信前に対象履歴を選択してください`,
    );
  }
  const button = (title: string, onPress: () => void) => (
    <Pressable disabled={busy} style={styles.button} onPress={onPress}>
      <Text style={styles.text}>{title}</Text>
    </Pressable>
  );
  let project = '未設定';
  try { project = configuredFirebase().projectId; } catch { /* Login reports config errors. */ }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Cloud Sync / 手動同期</Text>
      <Text style={styles.text}>
        Native SQLite → Firebase → Web。GPS・日時・診断情報を送信します。記録・STOP処理は同期を待ちません。
      </Text>
      <Text style={styles.text}>送信先：{mode === 'production' ? `本番Firebase / ${project}` : `PC内Emulator / ${host}`}</Text>
      {!uid && <>{button('本番Firebaseを選択', () => setMode('production'))}{button('PC内Emulatorを選択', () => setMode('emulator'))}</>}
      {!uid ? (
        <>
          {mode === 'emulator' && <><Text style={styles.text}>
            Emulatorホスト（Android Emulatorは10.0.2.2）
          </Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            accessibilityLabel="Emulatorホスト"
          /></>}
          <TextInput
            style={styles.input}
            placeholder="メールアドレス"
            placeholderTextColor="#aaa"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="パスワード"
            placeholderTextColor="#aaa"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {button("ログイン", () => void work(() => login(false)))}
          {button(
            mode === 'production' ? 'RunJourneyアカウント作成' : 'Emulatorテストアカウント作成',
            () => void work(() => login(true)),
          )}
        </>
      ) : (
        <>
          <Text style={styles.text}>所有者 UID: {uid}</Text>
          {button(
            "送信対象の履歴を確認（まだ送信しません）",
            () =>
              void work(async () => {
                const selected: RunSummary[] = [];
                for (let offset = 0; ; offset += 200) {
                  const page = await RunRepository.getReviewPage(200, offset);
                  selected.push(
                    ...page.filter((r) => r.trashedAt === undefined),
                  );
                  if (page.length < 200) break;
                }
                setPreview(selected);
              }),
          )}
          <Text style={styles.text}>
            対象 {preview.length}件 / GPS{" "}
            {preview.reduce((s, r) => s + r.pointCount, 0)}
            点。draftとごみ箱は対象外。
          </Text>
          {preview.length > 0 &&
            button(
              '表示した履歴を送信キューへ登録',
              () =>
                void work(async () => {
                  for (const run of preview) await queue!.enqueue(run.id);
                  setPreview([]);
                  setMessage(
                    "SQLiteの同期キューへ登録しました。原記録は変更していません",
                  );
                }),
            )}
          {button(
            "キューを送信 / 再試行",
            () =>
              void work(async () => {
                const result = await queue!.flush(Date.now(), true);
                setMessage(
                  result.length
                    ? "保留項目があります。エラーを確認してください"
                    : "キュー送信完了（SHA-256とGPS点数を再検証済み）",
                );
              }),
          )}
          {entries.map((e) => (
            <Text key={e.id} style={styles.text}>
              {e.id} · {e.status} · 試行 {e.attempts} ·{" "}
              {e.error ?? "エラーなし"}
            </Text>
          ))}
          {button(
            "ログアウト（保留キューは所有者別に保持）",
            () =>
              void work(async () => {
                await signOut(syncClient(mode, host).auth);
                setQueue(null);
                setUid("");
                setPassword('');
                setEntries([]);
                setPreview([]);
              }),
          )}
        </>
      )}
      {busy && <Text style={styles.text}>処理中…</Text>}
      {!!message && <Text style={styles.text}>{message}</Text>}
      {button("設定へ戻る", () => router.back())}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    padding: 26,
    paddingTop: 60,
    gap: 16,
    backgroundColor: "#111418",
    flexGrow: 1,
  },
  title: { color: "#fff", fontSize: 25, fontWeight: "700" },
  text: { color: "#d4ddd8", lineHeight: 24 },
  input: {
    borderWidth: 1,
    borderColor: "#697b70",
    color: "#fff",
    borderRadius: 8,
    padding: 14,
  },
  button: { backgroundColor: "#354e41", padding: 16, borderRadius: 8 },
});
