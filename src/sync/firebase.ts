import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  runTransaction,
} from "firebase/firestore";
import { Manifest, SyncConflict, Transport } from "./protocol";

// Deliberately emulator-only for this phase. No production project configuration is read.
export function emulatorClient(host = "127.0.0.1") {
  if (!["127.0.0.1", "localhost", "10.0.2.2"].includes(host))
    throw new Error("ローカルEmulatorのみ利用できます");
  const name = `runjourney-review-${host}`;
  const existing = getApps().find((app) => app.name === name);
  const app =
    existing ??
    initializeApp(
      {
        projectId: "demo-runjourney",
        apiKey: "demo-key",
        appId: "demo-runjourney",
      },
      name,
    );
  const auth = getAuth(app),
    db = getFirestore(app);
  if (!existing) {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
  }
  return { auth, db };
}
export function firebaseTransport(
  client: ReturnType<typeof emulatorClient>,
  uid: string,
): Transport {
  const { db, auth } = client;
  const check = () => {
    if (!uid || auth.currentUser?.uid !== uid)
      throw new Error("認証ユーザーが変更されました");
  };
  const runDoc = (id: string) =>
    doc(db, "runjourney", uid, "runs", encodeURIComponent(id));
  const chunkDoc = (id: string, hash: string, index: number) =>
    doc(
      db,
      "runjourney",
      uid,
      "payloads",
      `${encodeURIComponent(id)}_${hash}_${index}`,
    );
  return {
    async getManifest(id) {
      check();
      const value = await getDocFromServer(runDoc(id));
      return value.exists() ? (value.data() as Manifest) : null;
    },
    async getChunk(id, hash, index) {
      check();
      const value = await getDocFromServer(chunkDoc(id, hash, index));
      if (!value.exists()) throw new Error("GPSチャンクがありません");
      return value.data().data;
    },
    async putChunk(id, hash, index, data) {
      check();
      const ref = chunkDoc(id, hash, index);
      await runTransaction(db, async (tx) => {
        const prior = await tx.get(ref);
        check();
        if (prior.exists()) {
          if (prior.data().data !== data)
            throw new SyncConflict("既存GPS payloadと内容が異なります");
        } else tx.set(ref, { ownerUid: uid, data });
      });
    },
    async publish(manifest) {
      check();
      const ref = runDoc(manifest.id);
      await runTransaction(db, async (tx) => {
        const prior = await tx.get(ref);
        check();
        if (prior.exists()) {
          if (prior.data().hash !== manifest.hash)
            throw new SyncConflict("クラウドRun ID衝突");
        } else tx.set(ref, manifest);
      });
    },
    async list() {
      check();
      return (
        await getDocsFromServer(collection(db, "runjourney", uid, "runs"))
      ).docs.map((d) => d.data() as Manifest);
    },
  };
}
