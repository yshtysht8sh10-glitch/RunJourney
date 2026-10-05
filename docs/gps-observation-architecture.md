# GPS Observation Architecture — Issue #18 PoC

Sensor observation frequency != persistence frequency.

## Existing path and the five-second request

`RunService.startRun/restoreActiveRun → startLocationUpdatesAsync → Android
foreground location service → TaskManager.defineTask → toPoint →
RunRepository.appendActivePoints → detectStop → merge saved points →
effectiveDistance → AsyncStorage`.

There is no `watchPositionAsync` subscription or separate foreground watcher.
Foreground, background and screen-off all use the same registered location task.
Previously: Accuracy.High, timeInterval 5000ms, distanceInterval 5m (0m with
Auto Stop ON), deferredUpdatesInterval/Distance 0. The foreground service has
killServiceOnDestroy=false. iOS fitness/automatic-pause options are unchanged.

Installed expo-location 57.0.20 `LocationHelpers.kt` maps timeInterval to both
LocationRequest.Builder(interval) and setMinUpdateIntervalMillis(interval), and
also sets max update delay to that interval. High maps to high-accuracy priority.
The explicit 5000ms request is a concrete explanation for the observed roughly
4.5–5s cadence, not proof of every delay's cause. Distance gating, provider,
power management, batched delivery and device state also affect delivery.

[SDK 57 Location docs](https://docs.expo.dev/versions/v57.0.0/sdk/location/)
describe timeInterval as an Android minimum, not a one-second guarantee.

## Test-only PoC

```
Android / expo-location (High, 1000ms target, distanceInterval 0m)
    ↓ TaskManager batch (one receivedAt per callback)
RawLocationObservation
    ↓
RollingObservationBuffer (RAM, 10s event-time window)
    ├─ existing #7 detector (each chronological unique observation)
    ├─ quality / interval / batch diagnostic aggregates
    └─ future #21 inference / outliers / speed smoothing (not implemented)
    ↓ timestamp gate (5000ms)
Persisted GPS in RunRecord.points
    ↓ existing effective points / shared effective edges
Effective Run → distance / total & lap pace / average speed / history
```

Only `app.runjourney.mobile.test` requests the higher cadence and routes callbacks
through this PoC. Production keeps the previous request and append path. No native
dependency, RunRecord schema version or migration is introduced. Existing Test
registrations are refreshed when the app restores a Run; native TaskManager's
setOptions updates the registration without removing the Run.

Raw observations retain timestamp, latitude, longitude, nullable accuracy/speed,
optional altitude and callback receivedAt in RAM. Poor accuracy and missing speed
are retained, not treated as evidence of movement. Buffer API: add, getRecent,
getLatest, clear. It sorts and deduplicates timestamps, removes observations older
than latest timestamp minus 10s (inclusive boundary), and has a 256-entry burst
safety bound. getRecent accepts an explicit `now`; repository readers default to
wall time so silence returns an empty recent window. Event-time snapshots used
for diagnostics deliberately describe the last delivered window. Returned samples
are copies. A new Run / stop / JS restart starts a fresh buffer. No coordinates
from this buffer are added to the shared diagnostic report.

## Persistence and recovery

The first valid-coordinate fix is retained, then the first fix at least 5000ms
after the last retained timestamp. Irregular/gapped callbacks do not fabricate
points. Duplicate/stale/pre-start timestamps cannot enter the detector twice.
The gate restores its watermark from saved GPS; the last observation timestamp
is checkpointed in existing diagnostic counts. OS batches are sorted first.

RAM holds the active Test Run between callbacks: it is not loaded/saved in full
every second. Normal writes occur with a retained GPS fix; Auto Stop state changes
checkpoint immediately. Manual Break/Resume and STOP flush the latest eligible
trailing fix, so there may be a small number of additional boundary points.
At 1s regular input, 30 minutes yields about 1800 observations and 360–361 saved
points plus boundary fixes. Failed normal checkpoints retain selected points in
RAM and retry on the next callback. Process death loses the uncheckpointed tail
(normally <5s) and its aggregates, as with any RAM buffer. runtimeSegments makes
restarts visible. No existing history is rewritten.

Distance is still calculated exclusively from persisted GPS common effective
edges. It is NOT accumulated from 1s raw coordinates. A synthetic straight-line
test confirms identical total/lap/speed for the same 5s saved samples. Different
actual sampling times or earlier raw-driven stop/resume decisions can change the
measured result; unchanged algorithms do not imply bit-identical outdoor totals.
The #7 five-second confirmation, retroactive onset, user overrides and detector
thresholds remain unchanged. Higher input frequency can change detection timing;
this is an evaluation point. No #21 spatial spread, dwell, smoothing or new
movement/stationary inference is added. Replays from persisted GPS cannot recreate
all raw-driven actual events and remain explicitly labelled simulations.

## Diagnostics and first SO_51B experiment

Use Test settings → Auto Stop Diagnostics, or Run detail → Diagnostics.
After STOP, Copy/Share exports the retained report including `observation`.
Legacy reports show observation=null; there is no invented historical raw count.
Existing diagnostics.counts stores finite nonnegative GPS_OBS_* aggregates using
the existing schema, compatible with backup/import. Interval histograms have 100ms
bins and a >=60s overflow bin: median/p90/p95 are bin ranges, not exact quantiles.
Min/max/mean are exact across checkpointed chronological observations. Stats are
bounded independently of Run length. Callback gaps and timestamp intervals are
different measures. Capture includes delivered/accepted count, actual saved GPS
count, accuracy min/max/mean & poor/missing count, speed availability, callback
intervals/gaps, delivery lag, batch count/max batch, buffer current/max size,
runtimeSegments and AppState counts/interval distributions. AppState is sampled
at callback delivery; batched old observations may have been captured in another
state. It does not prove screen on/off. Mode-boundary intervals are omitted from
per-mode distributions.

1. Record Test version/Git, battery %, charging status, Auto Stop/Break settings,
   Android battery optimization setting and starting wall time manually.
2. Outdoors, run/walk for 5–10 minutes, first in foreground. If feasible switch
   screen off for a few minutes; write down when. Do not change power settings
   halfway without noting it. Keep charging status consistent for comparisons.
3. STOP, record ending battery %, duration and screen conditions. Copy/Share the
   diagnostics report and paste it into the conversation with those annotations.
4. Compare observation interval median/p90/p95, callback intervals/lag/batches,
   foreground/background distributions and observation vs saved counts. Check
   Auto Stop/BREAK events and distance/lap consistency too.
5. Decide whether 1s observation is achieved and useful before longer 30–60 minute
   battery comparisons. Short battery % differences are not reliable consumption
   measurements; no battery or outdoor cadence claim is made by this code.

Adoption decision is pending SO_51B data. Issue #18 stays open. Test updates must
verify package, certificate and increasing versionCode, then use adb install -r.
Never uninstall or clear Test/Production data; never install this APK as Production.
