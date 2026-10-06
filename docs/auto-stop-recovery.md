# Auto Stop window inference and non-destructive recovery (#21 / #26)

## Root cause

At starting HEAD 1116074, TaskManager sends Test observations to appendActiveObservations → GpsObservationSession (1s observations / 5s persistence gate) → detectStop v3 for every observation → events → effectiveDistance → RAM/checkpoint → UI/TTS. Production appendActivePoints feeds persisted points to the same detector. Diagnostics replay feeds saved ~5s points to that detector.

v3 Resume required previous-fix displacement >=3m AND speed>=1.2m/s. At 2m/s and 1s input, displacement≈2m, so movement is discarded with MOVEMENT_TOO_SMALL. At 5s displacement≈10m, replay can confirm. Large stop-origin displacement does not bypass the per-step gate. Effective GPS marks non-RUNNING points unusable, so these false stop events remove distance/time. The UI and persistence use those events; this is not evidence that the UI alone failed. User-supplied representative logs agree with this path; the complete raw diagnostic file has not been supplied.

## Inference v4

Use event-time rolling observations (max10s / 256 points); the Test ingest captures each observation's window before later batch points can affect it. Other inputs/replay build the same window. Accuracy<=20m, finite geographic coordinates, duplicate/stale suppression, >12.5m/s coordinate jumps held, >15s usable gaps reset evidence. Provider speed median is exported for context, not a hard gate.

Moving: >=5s coverage and >=3 valid fixes, displacement/time >=0.7m/s, displacement/path >=0.7, >=70% of edges have displacement/time>=0.5m/s. Stationary: >=5s coverage, spatial spread<=3m and net displacement/time<=0.35m/s. Earliest qualifying suffix is the candidate onset; first edge must support the target (moving>=0.5m/s, stationary<=0.5m/s). Confirmation timestamp is retained separately. Break is never sensor-resumed. A5s stream can require10s to collect3 points; cadence changes resolution/latency, not a fixed per-fix distance threshold. These are explainable Test parameters; urban jitter, tight turns, weak fixes and sub0.7m/s movement remain field risks.

A bounded window supports active checkpoint/restart. It is removed from completed RunRecord; all1s observations are not archived. The completed record keeps ~5s GPS plus the prior small detector anchors. Do not infer 2223 recoverable coordinates from diagnostic observationCount.

## Diagnostics

schema2: actualEvents and actualDiagnostics remain separate from currentReplay, v3Replay and historical legacyV4Replay. New live entries label inputSource, window duration/count/displacement/path/spread/speedMedian/coherence, candidate start/age, reason and effectiveTimestamp/confirmedAt. Keep720 recent decisions, plus up to4096 START/RESET/confirm trace entries and traceDropped. Counts are whole-run; export states retained evidence bounds. No coordinates in shared report. Old records lack new evidence; replay cannot manufacture it.

## Recovery

Pure recoveryPreview replays saved points, retaining manual events/Break. No runId constants, expected5km target or1s permanent archive. Add recovery={algorithm,appliedAt,events}; never overwrite original points/events/time/distance/diagnostics. Effective Run chooses the operation's events, so history/pace/laps/export use the shared metrics. Undo removes only the operation. Recovery is accessed from run detail, hidden from tabs, and requires an explicit confirmation after numeric Preview. Existing stopOverrides fail closed; undo Recovery before making a manual stop correction. This limitation is displayed rather than silently discarding edits. Backup schema1 preserves/validates optional recovery and v4 detector.

Preview also calculates candidate running distance/time inside original excluded Auto Stop intervals, reports GPS gaps, and preserves an untouched original. node scripts/preview-recovery.cjs <Backup.json> <runId> performs read-only local analysis and emits no coordinates. The actual October6 run's413 points are not present in available files; its recovery distance/time/transitions are unverified. Synthetic damaged-run test yields90m/45s/7.2km/h, not a result for the user's run.413 points can support this design; sufficiency and accuracy for that run require its Backup.

## Verification / next field session

Focused:6 suites48 tests pass, including1s/5s run/walk/stop, bouncing, jump, missing/low speed, poor accuracy, retroactive onset, Break, raw immutability, apply/undo, legacy, backup and preview confirmation UI. Retained v3 contracts are explicitly labelled historical audits; new v4 and repository suites exercise current semantics. Typecheck/lint pass. Outdoor acceptance is pending; #21/#26 stay OPEN.

Standalone Test versionCode13, production6 unchanged, existing signing key. Build uses the repository's already established standaloneTest Gradle variant after no-clean Expo prebuild. No uninstall/storage clear/Production install or Recovery application. Device update, if performed later, must verify certificate/package and use adb install -r only.

SO-51B: Auto Stop ON → START → run → signal stop → AUTO_STOP → step/bounce in place → remains stopped → run at≈2m/s → auto Resume → run several100m → STOP/history distance. Repeat screen OFF. Export Diagnostics; verify live transitions and candidate trace. Open Recovery Preview for the damaged2.68km record; compare GPS-derived candidate and warnings, export Backup for read-only analysis. Apply only after user review; verify undo separately.

Docs checked before API changes: https://docs.expo.dev/versions/v57.0.0/, https://docs.expo.dev/versions/v57.0.0/sdk/location/, https://docs.expo.dev/llms.txt, https://docs.expo.dev/router/basics/navigation/, https://reactnative.dev/docs/0.86/pressable.
