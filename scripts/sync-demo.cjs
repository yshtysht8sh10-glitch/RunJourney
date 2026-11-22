// Only synthetic data, only demo-runjourney emulators. No device/backup access.
require("./sqlite-pc-runtime.cjs");
const { open } = require("./sqlite-pc-runtime.cjs");

const {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} = require("firebase/auth");
const { terminate } = require("firebase/firestore");
const { deleteApp } = require("firebase/app");
const {
  emulatorClient,
  firebasePagedTransport,
} = require("../src/sync/firebase.ts");
const { PagedSyncQueue } = require("../src/sync/paged-protocol.ts");
const { SqlitePagedStore } = require("../src/repositories/paged-store.ts");
const { demoRuns } = require("../src/web/demo.ts");
(async () => {
  const client = emulatorClient(),
    local = open(":memory:");
  try {
    let credential;
    try {
      credential = await signInWithEmailAndPassword(
        client.auth,
        "runner@example.test",
        "synthetic-pass-123",
      );
    } catch (error) {
      if (
        !["auth/user-not-found", "auth/invalid-credential"].includes(error.code)
      )
        throw error;
      credential = await createUserWithEmailAndPassword(
        client.auth,
        "runner@example.test",
        "synthetic-pass-123",
      );
    }
    const uid = credential.user.uid;
    // Fixed epoch makes re-running seed idempotent, independent of the clock.
    for (const run of demoRuns(Date.parse("2026-10-17T03:00:00Z")).slice(0, 7))
      await local.store.complete(run);
    const key = "@runjourney/sync/demo";
    const paged = new SqlitePagedStore(local.store);
    const queue = new PagedSyncQueue(
      uid,
      {
        load: () => local.store.getSetting(key),
        save: (text) => local.store.setSetting(key, text),
      },
      (id) => paged.source(id),
      firebasePagedTransport(client, uid),
    );
    await queue.open();
    for (const run of await paged.list(200)) await queue.enqueue(run.id);
    await queue.flush();
    if (queue.state.length)
      throw new Error(
        JSON.stringify(queue.state.map((e) => ({ id: e.id, error: e.error }))),
      );
    console.log(
      "7 synthetic SQLite runs uploaded and verified. Web login: runner@example.test / synthetic-pass-123 (LOCAL EMULATOR ONLY).",
    );
  } finally {
    local.close();
    await terminate(client.db);
    await deleteApp(client.auth.app);
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
