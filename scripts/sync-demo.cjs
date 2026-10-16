// Only synthetic data, only demo-runjourney emulators. No device/backup access.
require("./sqlite-pc-runtime.cjs");
const { open } = require("./sqlite-pc-runtime.cjs");
const { createHash } = require("node:crypto");
const {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} = require("firebase/auth");
const { terminate } = require("firebase/firestore");
const { deleteApp } = require("firebase/app");
const {
  emulatorClient,
  firebaseTransport,
} = require("../src/sync/firebase.ts");
const { RunSyncQueue } = require("../src/sync/protocol.ts");
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
    const queue = new RunSyncQueue(
      uid,
      {
        load: () => local.store.getSetting(key),
        save: (text) => local.store.setSetting(key, text),
      },
      firebaseTransport(client, uid),
      async (text) => createHash("sha256").update(text).digest("hex"),
    );
    await queue.open();
    for (const run of await local.store.list()) await queue.enqueue(run);
    await queue.flush();
    if (queue.state.length)
      throw new Error(
        JSON.stringify(
          queue.state.map((e) => ({ id: e.run.id, error: e.error })),
        ),
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
