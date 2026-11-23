# Test v37 integration candidate

Scope: prepare device acceptance for the existing-development integration program (#78). Cycling has not started. This is not a main release, Production distribution, Issue closure or proof of physical audio.

## Dependency and preservation

Base: existing Test/Sensor `e273833`. Independent candidate branches are merged locally for a Test-only build; their original branches/PRs are retained.

- Legacy compatibility candidate #81 is retained separately and is not packaged in this focused Test build; no migration UI or legacy reader is added.
- Voice candidate: #82 through independently reviewed `be00768`, including durable PACE/clock, compact trace/export, UNKNOWN recovery and interruption fixes.
- Production artifact guard: original #80, already on main; retained in this candidate.
- Existing #77 physical OpenComm2/screen-off/listening acceptance is still required.

Only sensorTest's Standalone Test versionCode becomes 37 and its source label becomes sensors-v37-integration. Production config versionCode, Pace version and package suffixes are unchanged. No existing database, diagnostic directory or settings key is renamed to match the new version.

This candidate retains the existing Test SQLite repository and schema. Device verification must not import/restore old data or invoke trash retention. Preserve RUN/GPS/events/trash/settings/groups/protection, all prior diagnostics and marker files. Raw backup data stays outside this repository.

## Acceptance work still to execute

1. Reuse unchanged JS evidence (77 suites / 589 tests). Integrated run-announcer source through be00768 passed all 169 Native tests; the broader candidate also passed the separate 48 legacy-reader tests, but that module is excluded here. The integrated 95-minute GPS simulator passed both cases. Final typecheck/Lint and APK packaging checks are recorded with the build SHA.
2. Confirm the phone has no active RUN before any instrumentation or APK update. A location service was observed; it must not be assumed to be idle.
3. Obtain a consistent private backup and comparison manifest before update. The installed Test is release-mode/non-debuggable; `run-as` cannot produce a valid backup. Use the previously established safe extraction path only after confirming idle state and manual unlock when needed.
4. Build through the required EAS profile. Verify package, version, signing certificate, APK hash, 16KiB ZIP alignment (legacy AndroidX reader is excluded).
5. Install only Test after preservation is verified. Compare original data without deletion/restoration/retention calls.
6. Synthetic device inputs and Native fixture reads are reported separately from physical OpenComm2, listening, screen-off and real GPS.
7. Physical marker/voice trial: two presses on screen-on and two on screen-off, actual BEGIN/END ACK/audio correlation, then normal finish and authenticated retrieval. Request user participation only once the APK and trial setup are ready.

Build, installation, device acceptance and data comparison results must be added with the exact final SHA. Until those gates pass, affected product PRs remain Draft and their Issues remain open. Main-wide integration and cycling prerequisites are not complete.

2026-11-23 scope: PR77 e273833 is the parent of PR82 be00768. The focused branch contains both ancestors plus the independently reviewed Production build guard and Test-only version labeling. The larger prior integration branch is retained without rewriting or deleting it. No device data has been changed.

Build gate 2026-11-23: EAS sensorTest was rejected by the monthly Android quota (reset December 1). The owner explicitly authorized local Gradle building for Test v37 only, with the existing Test signature. This is not Production build/distribution permission. The read-only preservation tool was independently reviewed before execution.

Pre-update capture validated 549 original files, 73 completed RUNs, 35,713 GPS rows, 21 trash records, no draft, 24 protected IDs and schema2. ZIP checksum, every entry manifest, SQLite integrity and foreign keys passed on a private PC inspection copy; no on-device restore/migration was performed. V37 uses a new Test-only rolling log directory `voice-log-integration-v37` to avoid invoking seven-day retention on the original v36 log directory. Production's log destination is unchanged.
