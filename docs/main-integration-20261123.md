# Existing-development main integration, 2026-11-23

## Scope and order

This is a development-source integration, not Production distribution or physical acceptance. The owner's latest instruction permits integration with explicitly recorded device acceptance gaps. Owner-assisted tests are deferred until immediately before cycling work. Cycling has not started.

1. Start at main `c9291bf` (inventory #79 and Production artifact guard #80).
2. Integrate Test candidate #83 at `149380a`: sensor #77 at `e273833`, independently reviewed voice #82 at `be00768`, and route debounce #84 at `5088e05`. Merge `883c856` resolves only app.config.js, retaining both incoming configuration and the Production guard.
3. Integrate legacy-storage compatibility #81 at `d7a9077`, merge `91b1926`. The reader is a separate native module; normal Test storage bypasses Production legacy migration. No running detector, GPS request or normal storage schema is changed by this combination.
4. Block unsupported iOS shared storage before mounting native screens or opening SQLite; block accidental Web shared-SQLite calls. Preserve the independent Web ReviewApp and redirect four native-only routes using the existing Web route pattern.

Exact source-head ancestry includes #34, #35, #37, #39, #44, #46, #50, #57, #59, #63, #67, #70, #76, #77, #81, #82, #83 and #84. This list proves source inclusion only. Existing feature acceptance must not be inferred from ancestry. Alternative heads #71, #73, #74 and #75 remain separate: later Test code carries related diagnostic/voice work, but their exact heads are not merged and their remaining document/patch reconciliation is not claimed complete.

## Storage boundaries

- Existing Android Test uses the same runjourney.sqlite/schema2 and settings keys. Production legacy RKStorage is read through the bounded, read-only AndroidX driver. A detected legacy source blocks normal reads/writes until explicit confirmation; only an empty destination can receive an atomic, verified copy. This integration performs no such copy on an actual device.
- iOS native storage is intentionally unavailable, for both fresh and existing installations, until its legacy compatibility path exists. It must not silently open an empty history or write default settings. This is an open platform limitation, not iOS release readiness.
- Web ReviewApp retains its independent IndexedDB/localStorage path. Native history-group, marker and sensor routes redirect to Web home; native SQLite must not enter the Web bundle.
- Production build guard remains enabled. No new deployment workflows are present. No APK build/install, real-data deletion, restoration or migration is performed for this main integration.

## Verification and independent review

The final result is recorded below before merge. Earlier native evidence is reused only where source trees are identical: run-announcer equals #83/#84's reviewed tree; legacy-storage-reader equals #81's reviewed tree. Prior evidence: 169 integrated announcer tests, 16 focused route/lifecycle/log tests (including five new route-monitor tests), and 48 legacy-reader Robolectric tests across API28/33/35. These counts overlap and must not be summed as a new combined run. Test v37 did not package the legacy reader; actual driver loading/legacy update on the phone remains unverified.

New platform-guard tests cover iOS/Web failures before SQLite open, native legacy reads and settings writes. The integration suite explicitly selects Android instead of jest-expo's iOS default; individual platform tests still supply their own mocks. Initial full-suite failures exposed this test-environment mismatch; changing the environment does not relax the product guard. Web export initially exposed four missing platform redirects, subsequently added.

Independent review by the separate integration_review agent approves the storage/platform/config combination, subject to final checks. This is a separate-agent code review, not a claim of a GitHub approval from another account or physical acceptance.

## Preservation and remaining work

No device operations are needed for this integration. Reuse the private v37 preservation report: all original 73 RUN rows and 35,713 GPS rows retained through the update, 21 trash records, existing settings unchanged, and 533 prior diagnostic/audio payload hashes unchanged. A new short validation RUN and its settings key are retained. Backups, coordinates and keys stay outside GitHub/CI. These are earlier v37 results, not a new APK-update test of this main commit.

Keep #72 and every Issue requiring physical acceptance Open. Keep tracker #78 Open: feature completeness, alternative-head reconciliation, iOS storage, physical OpenComm2/voice/screen-off and cycling prerequisites remain. Other incomplete backlog items from the inventory are not closed by integration. Older nonperiodic voice TTL/recovery and TTS reinitialization limitations remain. New route debounce is not in the installed v37 APK and has no physical acceptance yet.

Next: reconcile outstanding alternative PR contents and unfinished implementation in small Issue batches, then prepare the consolidated owner-assisted evaluation before starting cycling. No branch or untracked artifact is deleted.
