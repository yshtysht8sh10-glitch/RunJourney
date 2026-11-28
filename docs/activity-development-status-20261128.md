# Activity assistant implementation ledger

PM implementation instruction received 2026-11-28. Parent #97, design PR #105 at 8951f2d,
base main c2aa35b. The Phase 0 documents remain historical design records.

## First increment: explicit profiles and distance policy (#101 prerequisite)

- Immutable allowlisted Running/Cycling/Generic profiles; generic cannot select an activity DB.
- Optional distance policy travels through effective edges and SQLite header recalculation.
- Existing Running callers, SQL schema/version, raw GPS, settings keys and Auto Stop are unchanged.
- Cycling's proposed 30m/s and 15s gap limits are engineering defaults requiring real-world acceptance.
- No Cycling START, DB open, settings defaults, new UI or task routing is enabled by this increment.
- Synthetic native SQLite tests use separate in-memory DBs, including identical IDs, raw GPS,
  settings, trash and deletion isolation. They do not prove device background continuity.

Focused tests: activity-distance-policy, run-model, pace-quality-baseline, sqlite-lifecycle:
39 passed. Typecheck and Lint passed (an unused test import was removed afterward).
An initial test attempted direct removal before trashing; the existing safety guard correctly
rejected it. The test now uses trash then deletion; no product deletion guard was changed.

## Remaining implementation

1. Native durable ownership/leases and legacy draft reconciliation, independent TOP settings/routes (#99).
2. Generic non-history measurement (#100), followed by Cycling's fixed DB/settings/service/UI (#101).
3. Profile-aware detector/voice integration (#102); read-only integrated history (#103).
4. Full integration, independent reviews and Test APK (#104).

No Issue is complete based on this increment. No device acceptance, installation or Production
delivery has occurred. Test v38 and Issue #93 remain separate and unchanged.

## Second increment: durable ownership port (#99 prerequisite)

`MeasurementOwnership` is a new Native port within the existing local module. It uses a
separate no-backup control file, AtomicFile ACK, process-wide monitor and cross-process file
lock. Purpose/destination/profile/generation are allowlisted. Persisted write leases block
STOP completion and next START; unknown, corrupt or failed states do not become IDLE.
No timeout releases uncertain writes. A failed final sink ACK retains ownership.

The TypeScript adapter validates Native replies and passes immutable binding into each
write callback, releasing its lease in finally. No JS-only lock fallback is available.
Both ports remain disconnected from GPS/UI/Running until legacy draft reconciliation and
the shared START/STOP adapters are implemented. A primitive alone is not cross-mode safety.
Settings snapshots, startup evidence and recovery of orphan leases remain integration work.

Validation: 9 JS tests and 9 Android Robolectric tests, typecheck/Lint/diff checks passed.
Robolectric covers eight simultaneous claimants, recreation, stop/drain/stale generation,
double release, corrupt control file and failed write. It is not a device/process-kill test.
Generated ignored Android files were created by Expo prebuild for unit tests only; no APK
was installed or distributed. Existing module audio paths are not invoked by this port.

## Third increment: Cycling recorder (#101, #102 prerequisite)

Fixed Cycling DB connection and independent settings plus a recorder built from the existing
SqliteStore, observation buffer/persistence gate, distance/time model and detector. Cycling
adds no Running schema columns. Optional detector edge-speed parameter keeps the exact
12.5m/s default; Cycling explicitly uses 30m/s. Remaining detector thresholds are unchanged.
No PACE, cloud or Running diagnostic journal is invoked by the Cycling recorder.

Each required checkpoint is awaited, so an eventual surrounding write lease can cover its
entire I/O lifetime; no untracked delayed checkpoint is introduced. Failed I/O retains a
cumulative RAM snapshot for retry, and final latest GPS is flushed before completion.
The recorder alone is not connected to START/task/UI and does not prove mutual exclusion.

Focused Cycling/Running/movement/PACE tests: 48 passed; typecheck/Lint passed. The manual
resume test initially assumed a permissive distance edge; it now explicitly asserts the
existing conservative boundary model (25m in that fixture). No production threshold or
boundary handling was relaxed. All SQLite test data are disposable in-memory synthetic data.

## Fourth increment: read-only activity metadata port (#99 prerequisite)

AndroidX's explicit read-only driver opens only the two fixed app-private Expo SQLite names.
Missing DBs are not created. Draft inspection checks the runs/active_run relationship and
rejects orphan/ambiguous drafts rather than treating them as IDLE. History reads are bounded
to 128 header rows, exclude trash without purging it, and do not read raw GPS tables.
Native offset pagination is an initial port; integrated history UI/summary is not connected.
The Running compatibility/migration gate remains unchanged and cannot be bypassed by this port.

Six synthetic Robolectric checks passed: absent files, same-ID isolated DB headers, bounded
history/trash exclusion, draft inspection without GPS tables, orphan refusal, corrupt-file
preservation and invalid capability/page refusal. Typecheck/Lint passed. Existing WAL behavior
is inherited from the previously reviewed read-only driver; new device/WAL acceptance is not
claimed by these six focused tests.
