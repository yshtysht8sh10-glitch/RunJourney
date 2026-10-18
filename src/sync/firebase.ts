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
import type { PagedRemote, PublishedRun } from "./paged-protocol";
import { hashText } from "../domain/pages";
import { configuredFirebase, CloudMode } from './firebase-config';

export function productionClient() {
  const config = configuredFirebase(), name = `runjourney-production-${config.projectId}`;
  const existing = getApps().find(app => app.name === name);
  if (existing && ['projectId','apiKey','appId','authDomain'].some(key => existing.options[key as keyof typeof existing.options] !== config[key as keyof typeof config])) throw new Error('本番Firebase設定が変更されました。再起動してください');
  const app = existing ?? initializeApp(config, name);
  return { auth: getAuth(app), db: getFirestore(app) };
}
export function syncClient(mode: CloudMode, host = '127.0.0.1') {
  return mode === 'production' ? productionClient() : emulatorClient(host);
}

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
export function firebasePagedTransport(
  client: ReturnType<typeof emulatorClient>,
  uid: string,
): PagedRemote {
  const { db, auth } = client;
  const check = () => {
    if (!uid || auth.currentUser?.uid !== uid)
      throw new Error("認証ユーザーが変更されました");
  };
  const runDoc = (id: string) =>
    doc(db, "runjourney", uid, "pagedRuns", encodeURIComponent(id));
  const blobDoc = (hash: string) => {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("不正なページhash");
    return doc(db, "runjourney", uid, "pageBlobs", hash);
  };
  return {
    async get(id) {
      check();
      const value = await getDocFromServer(runDoc(id));
      return value.exists() ? (value.data() as PublishedRun) : null;
    },
    async list() {
      check();
      return (
        await getDocsFromServer(collection(db, "runjourney", uid, "pagedRuns"))
      ).docs.map((d) => d.data() as PublishedRun);
    },
    async getBlob(hash) {
      check();
      const value = await getDocFromServer(blobDoc(hash));
      return value.exists() ? (value.data().data as string) : null;
    },
    async putBlob(hash, data) {
      check();
      if (
        hashText(data) !== hash ||
        new TextEncoder().encode(data).byteLength > 600000
      )
        throw new Error("ページhash/容量不一致");
      const ref = blobDoc(hash);
      await runTransaction(db, async (tx) => {
        const prior = await tx.get(ref);
        check();
        if (prior.exists()) {
          if (prior.data().data !== data)
            throw new SyncConflict("既存ページの内容不一致");
        } else tx.set(ref, { ownerUid: uid, hash, data });
      });
    },
    async publish(header) {
      check();
      const ref = runDoc(header.id);
      await runTransaction(db, async (tx) => {
        const prior = await tx.get(ref);
        check();
        if (prior.exists()) {
          if (prior.data().hash !== header.hash)
            throw new SyncConflict("既存Runのmanifest衝突");
        } else tx.set(ref, header);
      });
    },
  };
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
