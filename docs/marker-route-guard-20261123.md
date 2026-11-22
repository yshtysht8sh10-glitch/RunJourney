# Marker route handling — 2026-11-23

Related: #72, #77/#83 integration. Status: automated fix candidate; physical reception/listening acceptance remains pending.

## Evidence and uncertainty

In the v37 indoor validation RUN, both sensors reached RECORDING and accepted samples. The marker session subsequently sealed with `HEADSET_ROUTE_REMOVED`, INCOMPLETE and zero saved markers. The encrypted lifecycle audit was authenticated and the RUN ended through normal STOP/save. No conclusion about a forgotten physical press is drawn; no four-press acceptance was completed.

The old callback closed the session whenever **any** Bluetooth A2DP/SCO/BLE device was removed, including an input/profile removal while another Bluetooth output could remain. The audit confirms the removal-triggered close, but did not record the removed device's role or the remaining outputs. A genuine disconnect versus transient profile change cannot be conclusively reconstructed from this trial.

## Fix

- Only a removed Bluetooth **output** schedules a check; input-only removal does not end recording.
- Recheck current outputs after a one-second debounce. A remaining/restored Bluetooth output keeps the session alive.
- If all Bluetooth outputs are absent, retain the existing `HEADSET_ROUTE_REMOVED` incomplete close. Audio-service query errors close explicitly with `HEADSET_ROUTE_QUERY_FAILED`.
- Session ownership and destruction cancel stale callbacks. No device names, MACs or locations are logged.
- This changes Test marker route handling only. Sensor sampling, marker ACK order, Auto Stop/GPS/RUN persistence and speech priorities are unchanged.

## Validation and deferred acceptance

Related Native tests: 16 pass, zero failures. Includes existing marker lifecycle, acceptance and authentication tests plus five event-sequence tests for profile/input removal, restoration during grace, genuine loss, stale sessions, debounce and query failure. Typecheck/Lint and fixed-SHA independent review are recorded in the PR.

Under the owner's revised order, no further physical-button, listening, manual unlock or owner-assisted screen-off requests are made until the one-time pre-cycling evaluation. Main integration may proceed with explicit unverified-risk notes; mandatory physical acceptance is not waived and related Issues stay open.

Next automated checks: platform callback wiring and regression review. At the consolidated physical evaluation, verify actual OpenComm2 route changes, genuine disconnect, four BEGIN/END presses, ACK/audio correlation and screen-off continuity. This trial's condition labels are not movement ground truth.
