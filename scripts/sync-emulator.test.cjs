// Actual Firebase SDK + actual Firestore Security Rules + PC SQLite source.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { open } = require("./sqlite-pc-runtime.cjs");
const { initializeApp, deleteApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
} = require("firebase/auth");
const {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  terminate,
} = require("firebase/firestore");
const { firebaseTransport } = require("../src/sync/firebase.ts");
const { upload, download, RunSyncQueue } = require("../src/sync/protocol.ts");
const { demoRuns } = require("../src/web/demo.ts");
const digest = async (text) => createHash("sha256").update(text).digest("hex");
async function client(label) {
  const app = initializeApp(
    {
      projectId: "demo-runjourney",
      apiKey: "demo-key",
      appId: "demo-runjourney",
    },
    `${label}-${Date.now()}`,
  );
  const auth = getAuth(app),
    db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const { user } = await createUserWithEmailAndPassword(
    auth,
    `${label}-${Date.now()}@example.test`,
    "synthetic-pass-123",
  );
  return { app, auth, db, user };
}
test("Native SQLite → durable queue → Auth/Firestore → Web reader; actual rules deny foreign access and overwrite", async () => {
  const alice = await client("alice"),
    bob = await client("bob"),
    local = open(":memory:");
  try {
    const run = demoRuns()[0];
    await local.store.complete(run);
    const before = await local.store.list(true),
      key = `@runjourney/sync/${alice.user.uid}`;
    const transport = firebaseTransport(alice, alice.user.uid);
    const queue = new RunSyncQueue(
      alice.user.uid,
      {
        load: () => local.store.getSetting(key),
        save: (value) => local.store.setSetting(key, value),
      },
      transport,
      digest,
    );
    await queue.open();
    await queue.enqueue(before[0]);
    await queue.flush();
    assert.equal(queue.state.length, 0);
    const manifests = await transport.list();
    assert.equal(manifests.length, 1);
    assert.deepEqual(
      await download(manifests[0], alice.user.uid, transport, digest),
      run,
    );
    assert.deepEqual(await local.store.list(true), before);
    await upload(run, alice.user.uid, transport, digest);
    assert.equal((await transport.list()).length, 1);
    const unicode = { ...run, id: "unicode-payload", note: "🌙".repeat(65000) };
    const unicodeManifest = await upload(
      unicode,
      alice.user.uid,
      transport,
      digest,
    );
    assert.deepEqual(
      await download(unicodeManifest, alice.user.uid, transport, digest),
      unicode,
    );
    await assert.rejects(
      upload({ ...run, distanceMeters: 1 }, alice.user.uid, transport, digest),
      /上書き/,
    );
    const alicePath = [
      "runjourney",
      alice.user.uid,
      "runs",
      encodeURIComponent(run.id),
    ];
    await assert.rejects(
      getDocFromServer(doc(bob.db, ...alicePath)),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      setDoc(doc(bob.db, ...alicePath.slice(0, -1), "foreign"), manifests[0]),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      updateDoc(doc(alice.db, ...alicePath), { hash: "f".repeat(64) }),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      deleteDoc(doc(alice.db, ...alicePath)),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      setDoc(doc(alice.db, "users", alice.user.uid, "nodes", "taskmemo"), {
        data: "forbidden",
      }),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      setDoc(doc(alice.db, "runjourney", alice.user.uid, "runs", "bad"), {
        ...manifests[0],
        schemaVersion: 2,
      }),
      (e) => e.code === "permission-denied",
    );
    console.log(
      "Verified exact run/GPS/hash, immutable source, duplicate/collision, cross-user read/write, overwrite/delete, TaskMemo namespace isolation, future schema.",
    );
  } finally {
    local.close();
    await Promise.all([terminate(alice.db), terminate(bob.db)]);
    await Promise.all([deleteApp(alice.app), deleteApp(bob.app)]);
  }
});
