# Export / Import v1 (#15)

Backup is the canonical restore format. Analysis is a separate derived Markdown presenter and cannot be imported.

## Inventory and canonical backup

`format: "runjourney-backup"`, `schemaVersion: 1`, `exportedAt` (epoch milliseconds), `app` (version, versionCode, source applicationId, Git commit), `runs`.

RunRecord fields preserved: `id` (Crypto UUID, also accepts nonempty legacy IDs), `startedAt`, `endedAt`, `distanceMeters`, `points` (latitude/longitude/timestamp/accuracy/altitude/speed), `createdAt`, `updatedAt`, `features`, `events` (RUNNING/AUTO_STOP/BREAK, source, timestamp, confirmedAt, reason), `detector` (version, anchor, last, stillSince, movement), `stopOverrides` (included, updatedAt), `diagnostics` (entries/counts/processed), `trashedAt`. Unknown JSON extension fields are preserved; no inferred missing data or destructive migration. Edit operations currently consist of stopOverrides. Raw observations beyond persisted points are not separately stored.

Start/end and bookkeeping dates retain their existing string representation; point/event/trash times retain epoch milliseconds. Empty legacy bookkeeping dates and absent optional feature/event/detector fields are supported. Run order is start time then ID; object keys sort recursively. Nonfinite numbers fail export rather than become null. No device identifier, token, or settings is collected.

Backup v1 excludes Settings, voice preferences, and the in-progress run. It reads the completed-history key `@runjourney/runs/v1` without invoking automatic purge. All stored Active + Trash records, including expired trash still present, are exported. Existing keys and schema stay unchanged.

## Safe additive import

Settings → Data / Export・Import → select JSON → read/parse → format/version validation → all-record validation → version migration/normalization boundary → duplicate classification → preview → explicit confirmation → repository commit.

File selection and preview never write storage. Limits: 50 MiB file, 100,000 records, 1,000,000 elements per array, 24 nested JSON levels. Root/metadata, finite numeric values, GPS ranges, dates, nonnegative epoch timestamps, events/states/sources, detector, diagnostics, overrides and trash timestamps are validated. Unknown schema versions and prototype-related keys are rejected. Invalid JSON, wrong format, absent/unsupported version and invalid data have distinct errors. Future versions add centralized migration functions before normalization; no version conditionals in UI.

Duplicates use exact stable ID across both existing Active and Trash, plus duplicates within the file. Existing data wins: no overwrite, lifecycle change, or date-only fallback. Different IDs with identical dates remain distinct. A collision with the in-progress ID aborts the import rather than duplicating an unfinished activity.

The existing repository operation queue serializes imports with lifecycle/recording operations. Only preview-approved new candidates are passed to commit, so a duplicate deleted after preview cannot unexpectedly become a restored record. Immediately before commit it reads current history again, rechecks IDs, constructs final history, and issues one `AsyncStorage.setItem`. Zero additions means zero writes. Validation/read/write failure never intentionally clears storage, partially imports records, or touches settings/active-run keys. AsyncStorage does not provide a cross-platform rollback guarantee on physical storage failure: this is a single-key commit, not a multi-key transaction. Existing corrupt JSON fails closed.

Trash imports retain `trashedAt` and remain Trash. Expired trash is first imported intact; the next normal History/Trash read applies #20's existing seven-day purge. Preview explicitly warns about this. No immediate import purge or retention extension occurs.

Preview shows filename, total/new/duplicate/trash/target counts, oldest/latest dates. Completion shows actual added/skipped counts after the commit-time duplicate recheck. History/Trash refresh on focus.

Source applicationId is metadata only. Compatible Test → Production and reverse migration is supported; nobody should operate Production or import real data during automated testing.

## Files and privacy

SDK 57 `expo-document-picker` uses copyToCacheDirectory; `expo-file-system` File reads/writes the copy; `expo-sharing` opens the OS share sheet. MIME validation relies on JSON contents, allowing providers that label JSON as plain text. Picker cancellation is harmless. Native modules require a rebuilt app. File names use UTC ISO dates with safe punctuation: `runjourney-backup-YYYY-MM-DDTHH-mm-ssZ.json`, `runjourney-run-YYYY-MM-DDTHH-mm-ssZ.md`. Temporary private cache files are removed after use. Web local-file sharing is unavailable and reports an error.

Backup UI and confirmation warn that exact location history is included. The agent does not choose a sharing destination or upload files.

## Analysis

Active History Detail → Analysis Markdown Export. Individual runs are the v1 MVP; batch/all-run Analysis remains future work. Trash is rejected. `RunRecord → effectiveRun → Pace Analysis` supplies distance, wall/active times, pace, speed, marathon equivalent, five-minute active-time laps (including the final short lap), Auto Stop/Break intervals and inclusion effects. No parallel distance/lap calculation.

GPS summary contains persisted-point count, mean/max accuracy, poor/unknown accuracy counts, mean persisted interval; diagnostics includes detector version, processed count and aggregate counters. Separate raw observation count is N/A because it is not persisted. No coordinate arrays, detector anchors, diagnostic entry dumps, inferred addresses, or latitude/longitude fields are serialized. UI warns that exact coordinates are excluded but dates/IDs/activity information remain sensitive. Backup and Analysis serializers are independent.

## Manual device verification

1. Settings → Data / Export・Import → Backup Export; check privacy warning and save via OS sheet.
2. History → active run → Analysis Export; read five-minute laps and verify absence of precise coordinates.
3. Select the Backup → inspect preview only first; confirm counts and Trash policy. Cancel leaves storage unchanged.
4. A backup reselected on the source installation should report all IDs duplicate and zero additions. User reviews before any actual import. Repeat import must add zero records.
5. Test → Production migration is user-controlled and is not performed by the agent.

Issue #15 stays OPEN until user device verification. Fixture tests cover serializer, validator, duplicates, single-write/failure behavior, Trash lifecycle, analysis and approval UI, alongside existing History/Auto Stop/Pace/Voice regressions.
