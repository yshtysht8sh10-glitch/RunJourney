# Legacy storage compatibility — 2026-11-22

Status: implementation candidate, not a Production release or a completed migration of any user's data. Related integration tracker: #78.

## Problem and scope

main `626f4be` stores Android history, draft and settings in AsyncStorage's `RKStorage`. Test `e273833` opens `runjourney.sqlite` and excludes the old AsyncStorage native module. Simply merging the development lineage can expose an empty history while the old database still exists. The Production artifact guard remains enabled; this change never grants release permission.

The new compatibility gate applies only to Android `app.runjourney.mobile`. Existing Test/Pace SQLite is not imported, restored or cleared. iOS/Web legacy compatibility is unresolved and this candidate does not authorize broad cross-platform SQLite activation.

## Reader

`modules/legacy-storage-reader` opens only the application's fixed `RKStorage`, read-only, on one worker. It uses AndroidX BundledSQLiteDriver 2.6.2 with SQLITE_OPEN_READONLY and BEGIN DEFERRED; no Android framework corruption handler can delete the source. It does not copy, checkpoint, repair or delete the old DB/WAL.

One bounded read-only transaction covers the manifest and every chunk. Raw UTF-8 BLOB slices of 16KiB form SHA-256; returned TEXT slices contain at most 16,384 Unicode codepoints. JS checks offsets, lengths, terminal flags and the original UTF-8 hash. Unknown `@runjourney/` settings are retained verbatim.

Limits: 512 keys, 256 codepoints per key, 32MiB total Native raw UTF-8, one session, five-minute timeout. JS separately limits the source to 8Mi codepoints to bound JSON expansion. Exceeding a limit is an explicit failure, never a report of empty history. Values with embedded NUL, unsupported types, malformed keys or corruption fail closed.

**Android API 28/33/35:** the first framework-based candidate could not establish a safe read-only transaction below API35. The follow-up uses AndroidX's public bundled driver and verifies the same transaction on all three API levels. There is no hidden-API, SQL-parser, writable or immutable fallback. The connected Test phone reports API33; its actual driver loading and upgrade regression are still unverified.

Read-only SQLite may create missing WAL/SHM runtime sidecars. This is permitted by SQLite's read-only WAL specification and is distinguished from writing original records. The application does not create, remove, truncate, repair or checkpoint them. Existing SHM read marks are SQLite-managed; synthetic tests verify original main DB and existing WAL contents remain unchanged. Closed clean WAL-mode sources, missing SHM and uncommitted WAL tails are covered; inability to create required sidecars fails closed.

## Gate and explicit copy

`storage-compatibility.ts` checks before ordinary `database()` access and before mounting tabs. It blocks new RUN, settings defaults, normal history access and background repository writes while migration is required or failed. Initial schema creation is allowed, but no ordinary RUN/settings data is written before compatibility succeeds.

The screen offers explicit confirmation; it does not auto-copy. Confirmation reopens a fresh consistent source snapshot and verifies its fingerprint has not changed. `legacy-migration.ts` strictly parses history and draft. History/draft ID collisions, including an interrupted legacy finish with two same-ID copies, require separate recovery and are not silently combined.

`SqliteStore.migrateLegacyEmpty()` is separate from normal restore/import. Every destination table must be empty. A single transaction copies all history (including expired trash), ended or unfinished draft, raw GPS/events, unknown JSON fields and settings strings. Imported IDs receive explicit retention protection. Internal readback compares the complete canonical snapshot before committing the migration receipt in the same transaction. Unsupported pace metadata that the normal serializer would drop causes rollback instead of a lossy success.

Disk errors, validation failures, readback mismatch or receipt failures roll back the entire copy. An interrupted transaction remains retryable. A committed receipt prevents duplicate copy; subsequent checks compare the retained source fingerprint. Changed source or invalid receipt blocks access. Dedicated `useNewConnection` connections are closed in `finally`, without closing the ordinary repository connection.

No lifecycle purge, automatic ended-draft finalization, old-data deletion, real-data restore or device installation was performed.

## Validation

- Native Robolectric final driver: 48 tests, zero failures/skips (16 each on API28/33/35). Includes >4MB emoji, original UTF-8 SHA-256, bounded chunks, malformed schema/types/limits/expiry, closed WAL/missing SHM/uncommitted WAL tail/concurrent writer snapshots, actual UPDATE rejection and original DB/WAL preservation. Sidecar creation failure uses obstructing directory fixtures, not an actual full disk or OS permission revocation. See the module README for ABI/16KiB ELF and size measurements.
- Migration and coordinator tests: 18 pass using the production SQL against PC native SQLite, not a KV-only mock. Covers exact values/order/expired trash/ended draft/settings, collisions, nonempty targets, chunks/hash corruption, serializer loss detection, disk/receipt failure rollback and restart retry, explicit gate, Test bypass and source-change rejection.
- Full JS/SQLite regression after the connection-lifecycle adjustment: 76 suites / 577 tests pass. The separate 95-minute GPS simulator (seed49) passes both cases, including the normal device adapter/repository/detector/SQL path under synthetic six-second disk stalls.
- Typecheck and Expo Lint: pass. No new lint warnings.
- Physical Android update, actual legacy Production migration, Bluetooth, screen-off and real-data preservation before/after an APK update: **not performed by this change**.

## Remaining gates

An independent fixed-SHA review is required. Actual API33 driver loading, iOS/Web legacy storage, synthetic Android update fixtures, actual Test APK regression and existing-data comparison remain open. This candidate is not permission to merge all 145 development commits, close a feature Issue, or start cycling development.
