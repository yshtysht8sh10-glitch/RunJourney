# Test v37 integration candidate

Scope: prepare device acceptance for the existing-development integration program (#78). Cycling has not started. This is not a main release, Production distribution, Issue closure or proof of physical audio.

## Dependency and preservation

Base: existing Test/Sensor `e273833`. Independent candidate branches are merged locally for a Test-only build; their original branches/PRs are retained.

- Legacy compatibility candidate: #81, reviewed `d7a9077` (AndroidX read-only reader `fe4ff1e`).
- Voice candidate: #82, reviewed fixed scopes `1bc3503` (durable receipt failures), `d62c481` (compact trace/export); later revisions require their own review.
- Production artifact guard: original #80, already on main; retained in this candidate.
- Existing #77 physical OpenComm2/screen-off/listening acceptance is still required.

Only sensorTest's Standalone Test versionCode becomes 37 and its source label becomes sensors-v37-integration. Production config versionCode, Pace version and package suffixes are unchanged. No existing database, diagnostic directory or settings key is renamed to match the new version.

The Android legacy migration gate excludes the installed Test/Pace SQLite store. Device verification must not import/restore old data or invoke trash retention. Preserve RUN/GPS/events/trash/settings/groups/protection, all prior diagnostics and marker files. Raw backup data stays outside this repository.

## Acceptance work still to execute

1. Run combined typecheck, Lint, JS/SQLite, both Native module suites and 95-minute seeded GPS simulation on the exact candidate.
2. Confirm the phone has no active RUN before any instrumentation or APK update. A location service was observed; it must not be assumed to be idle.
3. Obtain a consistent private backup and comparison manifest before update. The installed Test is release-mode/non-debuggable; `run-as` cannot produce a valid backup. Use the previously established safe extraction path only after confirming idle state and manual unlock when needed.
4. Build through the required EAS profile. Verify package, version, signing certificate, APK hash, 16KiB ZIP alignment and AndroidX JNI loading.
5. Install only Test after preservation is verified. Compare original data without deletion/restoration/retention calls.
6. Synthetic device inputs and Native fixture reads are reported separately from physical OpenComm2, listening, screen-off and real GPS.
7. Physical marker/voice trial: two presses on screen-on and two on screen-off, actual BEGIN/END ACK/audio correlation, then normal finish and authenticated retrieval. Request user participation only once the APK and trial setup are ready.

Build, installation, device acceptance and data comparison results must be added with the exact final SHA. Until those gates pass, affected product PRs remain Draft and their Issues remain open. Main-wide integration and cycling prerequisites are not complete.
