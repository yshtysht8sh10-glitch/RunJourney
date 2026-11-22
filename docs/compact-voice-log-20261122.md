# Compact voice trace — Test integration candidate

2026-11-22. Native implementation `609df81`; related integration tracker #78 and voice candidate PR #82. This is additive Test telemetry, not an assertion that every notification or physical audio has been accepted.

## Storage and privacy

Only `app.runjourney.mobile.test` writes the new `voice-compact-v1` directory. Existing `voice-log-feedback-v36`, prior logs, RUN, GPS, sensor files and diagnostics remain untouched by the new trace. The old rolling log's existing retention rules remain unchanged.

`VoiceLogStorage` appends the compact trace on its existing single worker, independently of the ordinary log's success. A strict allowlist retains notification kind, lifecycle status/reason, schedule/generation/queue/body/completion times, slot/interval boundaries, and event indices. RUN and notification identifiers are SHA-256 aliases. Arbitrary data objects, message bodies, raw GPS, paths, addresses, keys, audio and Bluetooth identifiers are excluded. Trace files are private local diagnostics, not an automatic GitHub or network export.

New payload is bounded to 8MiB per RUN and 64MiB across traces. The RUN catalog is bounded to 256 entries. Small metadata and atomic temporary files are additional to the payload quota, so 64MiB is not a strict total-directory-byte promise. The trace never deletes old files to free space or rolls away the beginning of an active RUN.

Capacity, interrupted or failed writes, invalid tails, and worker queue overflow are marked as incomplete. Ordinary RUN and speech are not stopped. `NO_TRACE` is incomplete, not zero-event success. Metadata failure is also reported. Partial write bytes count towards capacity; original partial tails are retained rather than truncated.

## Read and Export

Native exposes Test-only `compactVoiceStats(runId)` and `compactVoicePage(runId, offset, endOffset)`. A page request must use valid line boundaries and a fixed end within the readable prefix. Diagnostic reads do not purge RUN history or the trace.

The Auto Stop Diagnostics screen has a separate **RUN全区間の音声追跡（Test）** section, with a status button and **全区間の音声追跡JSONをExport**. The existing selected RUN is used. Original rolling-log Export remains available separately.

TS fixes `stats.readableBytes` before pagination, verifies advancing byte offsets, terminal flags, contiguous record sequence and captured record count. Appends after that point are excluded from this export and visible in its final status. Incomplete flags are retained in exported JSON. Export writes a new temporary cache file through the existing sharing helper; it does not alter the stored trace.

## Executed tests

- Native total after this addition: 26 suites / 153 tests, zero failures/skips.
- New cases cover privacy, exact sequence through reopen/pages, fixed export range, partial/failed writes, actual worker overflow, quotas/catalog, no-trace, interrupted process state and metadata failure.
- Synthetic 150 minutes, one record/second: 9,000 records, 2,793,190 payload bytes.
- Synthetic four hours, one record/second: 14,400 records, 4,495,696 payload bytes.
- Both append/reopen/full-page sequence tests together took 16.1 seconds on the PC host. This is not phone CPU, battery, temperature or I/O performance evidence.
- TS pagination/export tests: five pass. Full JS/SQLite regression: 77 suites / 589 tests pass. Typecheck and Expo Lint pass with zero warnings.

## Limits and remaining acceptance

The trace does not independently prove RUN start/end. `runEndObserved` reflects a completed RUN-end voice event; it is not SQLite save authentication. A process can die after worker overflow is observed in RAM but before the loss marker is persisted, so the exact lost count is not always recoverable. Unclean restart and absent-trace flags help expose uncertainty; they do not establish complete delivery.

Physical device loading, Bluetooth, screen-off, natural Doze, performance, before/after existing-data comparison and independent review of this added scope are required. A trace `DONE` does not establish that a listener heard the audio. Existing non-periodic voice TTL/recovery paths are still separate unfinished work. Do not use this candidate alone to close the all-voice reliability Issues.
