# Issue #28 stop dwell evaluation (2026-10-08)

The v4 stop rule requires spread <=3m and a slow first edge. A synthetic
alternating 4–8m trace with reported speed 2m/s cannot satisfy that rule,
even with zero sustained displacement. This reproduces the candidate failure
mechanism; it is not proof of the user's physical foot-stepping GPS trace.

The repository's #18 field evaluation documents ~1s observations, ~5.43s
persisted fixes and predominantly background callbacks. The #28 Issue reports
the symptom on Test v13, but contains no coordinate-free window diagnostics.
SO-51B is not connected at implementation time, so the actual failing windows
cannot be inspected. No threshold is presented as calibrated to that run.

Keep the narrow stillness rule and the exact Resume predicate. Add bounded
dwell: >=8s, >=5 valid observations, spread <=8m (existing stop radius), net
speed <=0.35m/s (existing stop net-speed limit), displacement/path <=0.35,
and no coherent movement. Unlike the narrow rule, fast reversing first edges
do not disqualify this evidence. Confirmation excludes time from the evidence
onset through the existing event/Effective Run path. Raw GPS and manual BREAK,
stop corrections, distance and time calculations remain intact.

Window diagnostics now include net displacement speed, moving edge ratio and
the stop evidence type. Existing trace retains candidate/reset/confirmation
times without coordinates. Recovery algorithm identity is updated; old v4
backups remain readable and saved recovery events are not recalculated.

Synthetic tests cover alternating 4/6/8m motion (8s confirmation), immediate
normal resume, coherent walking/jogging, wider motion, poor accuracy and OFF;
the existing jitter, spike, gap, BREAK, persistence, time and distance tests pass.
Sparse GPS may not have enough samples for dwell evidence; no samples or
movement are invented. Smooth GPS drift and bounded physical pacing remain
ambiguous: field validation is required before closing #28. Capture Diagnostics
after foot-stepping, jumping, walking and screen-off tests with their times.
