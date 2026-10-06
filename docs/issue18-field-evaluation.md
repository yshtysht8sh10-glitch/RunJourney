# Issue #18 field PoC evaluation — 2026-10-07

User-reported SO-51B Test v12 / 1116074 run, 2026-10-06T15:31:03.398Z–16:08:24.609Z (37m21s), predominantly screen off:
- 2223 observations / 2224 delivered, average interval ~1008ms; median/p90/p95 ~1s.
- 2131 background callbacks; two callback gaps >5s; rolling buffer max 11.
- 413 persisted GPS points; 50 poor/missing accuracy observations; speed available 2223.
- Battery fell approximately 2 percentage points while music was also playing. This is combined device consumption, not RunJourney-only consumption. No abnormal drain is evident in this single run; a controlled comparison remains unmeasured.

The 5000ms persistence gate selects the first observation at least 5000ms after the previous saved fix; it is not a fixed-grid sampler. 413 points in 2241s (~5.43s mean, with boundary flushes) is consistent with this gate and timing variation. Exact interval distribution requires the raw Backup.

Adopt the observation/persistence separation for Test: >30m real-world background/screen-off evidence supports the PoC. Foreground callbacks existed, but separate foreground interval distribution has not been supplied. Other devices, OS power restrictions, restart gaps, controlled CPU/battery comparisons and production rollout remain risks/limitations, not guarantees.

The old Auto Stop consumer has a critical per-fix movement threshold regression at 1s input (#21). The observation layer is collecting evidence correctly; the old consumer is not validated for production use. #18 is evaluated as an observation-layer PoC, not approval of Auto Stop correctness. Coordinates are RAM-only except for persisted GPS and the bounded detector anchor/last; aggregate diagnostics are retained. No permanent 2223-point archive exists.
