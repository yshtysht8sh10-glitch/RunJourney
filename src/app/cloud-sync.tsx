import { CloudMode, configuredFirebase } from "../sync/firebase-config";
import { useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
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
import { syncClient } from "../sync/firebase";
import { PagedSyncQueue } from "../sync/paged-protocol";
import { RunRepository } from "../repositories/run-repository";
import { nativeQueue } from "../sync/native-queue";
import { RunSummary } from "../domain/pages";

// Separate opt-in screen. Recording/STOP and production data paths never depend on sync.
export default function CloudSyncScreen() {
  const { runId } = useLocalSearchParams<{ runId?: string }>();
  const inFlight = useRef(false);
  const [mode, setMode] = useState<CloudMode>("production");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [host, setHost] = useState("127.0.0.1");
  const [uid, setUid] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState<RunSummary[]>([]),
    [entries, setEntries] = useState<PagedSyncQueue["state"]>([]);
  const [queue, setQueue] = useState<PagedSyncQueue | null>(null);
  const queueRef = useRef<PagedSyncQueue | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  async function work(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setEntries(queueRef.current?.state ?? []);
    }
  }
  async function login(create: boolean) {
    const client = syncClient(mode, host);
    const credential = await (create
      ? createUserWithEmailAndPassword(client.auth, email, password)
      : signInWithEmailAndPassword(client.auth, email, password));
    const owner = credential.user.uid;
    const next = await nativeQueue(mode, host, owner);
    queueRef.current = next;
    setQueue(next);
    setEntries(next.state);
    setUid(owner);
    setPassword("");
    setPreview([]);
    setSelected([]);
    setMessage(
      `${mode === "production" ? "本番Firebase" : "Emulator"}にログインしました。送信前に対象履歴を選択してください`,
    );
  }

  let project = "未設定";
  try {
    project = configuredFirebase().projectId;
  } catch {
    /* Login reports config errors. */
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Cloud Sync / 手動同期</Text>
      <Text style={styles.text}>
        Native SQLite → Firebase →
        Web。GPS・日時・診断情報を送信します。記録・STOP処理は同期を待ちません。
      </Text>
      <Text style={styles.text}>
        送信先：
        {mode === "production"
          ? `本番Firebase / ${project}`
          : `PC内Emulator / ${host}`}
      </Text>
      {!uid && (
        <>
          {
            <SyncButton
              disabled={busy}
              title={"本番Firebaseを選択"}
              onPress={() => setMode("production")}
            />
          }
          {
            <SyncButton
              disabled={busy}
              title={"PC内Emulatorを選択"}
              onPress={() => setMode("emulator")}
            />
          }
        </>
      )}
      {!uid ? (
        <>
          <Text style={styles.text}>
            Webと同じRunJourneyアカウントでログインしてください。再起動後は再ログインが必要です。登録・ログインだけでは送信しません。
          </Text>
          {mode === "emulator" && (
            <>
              <Text style={styles.text}>
                Emulatorホスト（Android Emulatorは10.0.2.2）
              </Text>
              <TextInput
                style={styles.input}
                value={host}
                onChangeText={setHost}
                autoCapitalize="none"
                accessibilityLabel="Emulatorホスト"
              />
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder="メールアドレス"
            placeholderTextColor="#aaa"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel="メールアドレス"
          />
          <TextInput
            style={styles.input}
            placeholder="パスワード"
            placeholderTextColor="#aaa"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel="パスワード"
          />
          {
            <SyncButton
              disabled={busy}
              title={"ログイン"}
              onPress={() => void work(() => login(false))}
            />
          }
          {
            <SyncButton
              disabled={busy}
              title={
                mode === "production"
                  ? "RunJourneyアカウント作成"
                  : "Emulatorテストアカウント作成"
              }
              onPress={() => void work(() => login(true))}
            />
          }
        </>
      ) : (
        <>
          <Text style={styles.text}>所有者 UID: {uid}</Text>
          {
            <SyncButton
              disabled={busy}
              title={"送信対象の履歴を確認（まだ送信しません）"}
              onPress={() =>
                void work(async () => {
                  const selected: RunSummary[] = [];
                  for (let offset = 0; ; offset += 200) {
                    const page = await RunRepository.getReviewPage(200, offset);
                    selected.push(
                      ...page.filter(
                        (r) =>
                          r.trashedAt === undefined &&
                          (!runId || r.id === runId),
                      ),
                    );
                    if (page.length < 200) break;
                  }
                  setPreview(selected);
                  setSelected(
                    selected.filter((r) => !r.error).map((r) => r.id),
                  );
                  setMessage(
                    selected.length
                      ? "送る履歴を選んでください。まだ送信していません"
                      : "送信対象の保存済み履歴はありません",
                  );
                })
              }
            />
          }
          <Text style={styles.text}>
            選択 {selected.length}件 / 候補 {preview.length}件 / GPS{" "}
            {preview
              .filter((r) => selected.includes(r.id))
              .reduce((s, r) => s + r.pointCount, 0)}
            点。draftとごみ箱は対象外。
          </Text>
          {preview.map((run) => (
            <Pressable
              key={run.id}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: selected.includes(run.id),
                disabled: !!run.error || busy,
              }}
              disabled={busy || !!run.error}
              style={styles.button}
              onPress={() =>
                setSelected((ids) =>
                  ids.includes(run.id)
                    ? ids.filter((id) => id !== run.id)
                    : [...ids, run.id],
                )
              }
            >
              <Text style={styles.text}>
                {selected.includes(run.id) ? "☑" : "☐"}{" "}
                {new Date(run.startedAt).toLocaleString("ja-JP")} /{" "}
                {(run.distanceMeters / 1000).toFixed(2)}km / GPS{" "}
                {run.pointCount}点
              </Text>
              <Text style={styles.text}>
                {run.id}
                {run.error ? ` / 読出エラー：${run.error}` : ""}
              </Text>
            </Pressable>
          ))}
          {preview.length > 0 && (
            <SyncButton
              disabled={busy || selected.length === 0}
              title={"選択した履歴を送信キューへ登録"}
              onPress={() =>
                void work(async () => {
                  for (const id of selected) await queue!.enqueue(id);
                  setEntries(queue!.state);
                  setPreview([]);
                  setSelected([]);
                  setMessage(
                    "SQLiteの同期キューへ登録しました。原記録は変更していません",
                  );
                })
              }
            />
          )}
          {
            <SyncButton
              disabled={busy || entries.length === 0}
              title={"キューを送信 / 再試行"}
              onPress={() =>
                void work(async () => {
                  const result = await queue!.flush(Date.now(), true);
                  setEntries(result);
                  setMessage(
                    result.length
                      ? "保留項目があります。エラーを確認してください"
                      : "キュー送信完了（SHA-256とGPS点数を再検証済み）",
                  );
                })
              }
            />
          }
          {entries.map((e) => (
            <Text key={e.id} style={styles.text}>
              {e.id} · {e.status} · 試行 {e.attempts} ·{" "}
              {e.error ?? "エラーなし"}
            </Text>
          ))}
          {
            <SyncButton
              disabled={busy}
              title={"ログアウト（保留キューは所有者別に保持）"}
              onPress={() =>
                void work(async () => {
                  await signOut(syncClient(mode, host).auth);
                  queueRef.current = null;
                  setQueue(null);
                  setUid("");
                  setPassword("");
                  setEntries([]);
                  setPreview([]);
                  setSelected([]);
                })
              }
            />
          }
        </>
      )}
      {busy && <Text style={styles.text}>処理中…</Text>}
      {!!message && <Text style={styles.text}>{message}</Text>}
      {
        <SyncButton
          disabled={busy}
          title={"設定へ戻る"}
          onPress={() => router.back()}
        />
      }
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
function SyncButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[styles.button, disabled && { opacity: 0.5 }]}
      onPress={onPress}
    >
      <Text style={styles.text}>{title}</Text>
    </Pressable>
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
