# OpenComm2 isolated marker routing PoC

This is a **test-only instrumentation helper**, not a RunJourney field APK. It targets only `app.runjourney.mobile.test`, requires the matching Test signing certificate, and additionally checks the package at runtime. Do not distribute it as the running application.

The default receiver does not call GPS registration, the Auto Stop detector, SQLite, diagnostic journals or existing voice-log append/read code. Its optional activation cue plays the existing common chime resource directly once. A paused MediaSession is never reported as playing except during that real cue; no silent audio track, forced routing, audio-focus request or preference reset is used. The separate `speech=true` diagnostic option calls the unchanged native voice queue with artificial text and redirects only that process's audit writer to a new private directory, preserving original voice chunks. Never use instrumentation during a real RUN.

## Build and policy test

Use a private output directory outside the repository. Android SDK platform/build-tools 36 and JDK 17+ are required. `DebugKeystore` must be the already-matching Test certificate; never create a new signing identity to replace installed data.

```powershell
./tools/opencomm2-poc/build.ps1 -OutputDirectory <private-output> -DebugKeystore <matching-test-keystore>
adb install -r -t --no-incremental <private-output>/marker-probe.apk
```

The build runs the standalone `MarkerKeysTest`: key-up/repeat/unrelated inputs, duplicate downs, separate devices and the 1,024-key fail-closed capacity. It checks 2,084 assertions, not 2,084 independent scenarios. Its key policy source is shared with the Test marker service. On the tested phone the headset reports zero key timestamps: complete down/up cycles must be accepted independently, rather than storing `device:0` as a duplicate forever. Receipt time is not physical-press time.

## Device run

First preserve the whole existing application snapshot and encrypted diagnostic file hashes, and confirm no active RUN. Instrumentation restarts the Test process; never run this tool during a real RUN or while collecting diagnostics. USB debugging does not authorize bypassing the device lock. The main RunJourney APK is not updated by installing this helper.

```powershell
adb shell am instrument -w -r -e seconds 180 -e phase silent-screen-on app.runjourney.markerprobe/app.runjourney.markerprobe.MarkerProbe
adb shell am instrument -w -r -e seconds 180 -e phase screen-off -e cue true app.runjourney.markerprobe/app.runjourney.markerprobe.MarkerProbe
```

Capture output **only to private files**, not GitHub or CI. A real ten-press test terminates after ten accepted callbacks; otherwise it ends at its bounded timeout. The bounded partial wakelock is released in `finally`. `READY`/`KEY`/`TRANSPORT`/`FINISHED` are also emitted under the dedicated `RunJourneyMarkerProbe` logcat tag. Logcat is not cleared. No GPS, route, RUN identifier or Bluetooth address is recorded.

`KEY` preserves uptime-based key timestamps and receipt wall/elapsed/uptime. `TRANSPORT` covers direct `onPlay`/`onPause` callbacks, where a physical key event timestamp is unavailable. Neither callback calls a player, the TTS service, RUN start/stop or the default media handler. STOP/NEXT/PREVIOUS callbacks are observed but not accepted as markers. This helper counts callbacks only; it does not label a real stop/resume or persist a field marker ledger.

`MarkerInventory` reads hashes of the diagnostic directory and old voice-log chunks without calling their retention logic. It never decrypts data or reads Keystore keys. Its output contains local file names and must also stay private.

Synthetic `cmd media_session dispatch`/ADB key events are controls for the receiver, **not physical-headset acceptance evidence**. Keep their injection times and results separate from the user's real presses. A `presses=1` result containing one synthetic control and zero physical callbacks is not a one-of-ten success.

## Adoption gate

All required conditions must pass with real OpenComm2 presses: foreground silent, screen-off silent, normal speech/chime playback, and application-switch interference. Verify ten real presses without loss/duplicates per condition, and verify speech is not stopped. A selected media-button session, a successful synthetic event, hearing the activation cue, or JVM tests alone do not prove headset reception.

If a necessary gate fails, do not add this to a field APK, force the OS's selected session, loop silent audio, reset the headset or claim ground-truth labels. Use the existing Test version for an observation-only RUN. Preserve failed trial logs and state what remains untested.
