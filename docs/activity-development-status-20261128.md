# Activity assistant implementation ledger

PM implementation instruction received 2026-11-28. Parent #97, design PR #105 at 8951f2d,
base main c2aa35b. The Phase 0 documents remain historical design records.

## First increment: explicit profiles and distance policy (#101 prerequisite)

- Immutable allowlisted Running/Cycling/Generic profiles; generic cannot select an activity DB.
- Optional distance policy travels through effective edges and SQLite header recalculation.
- Existing Running callers, SQL schema/version, raw GPS, settings keys and Auto Stop are unchanged.
- Cycling's proposed 30m/s and 15s gap limits are engineering defaults requiring real-world acceptance.
- No Cycling START, DB open, settings defaults, new UI or task routing is enabled by this increment.
- Synthetic native SQLite tests use separate in-memory DBs, including identical IDs, raw GPS,
  settings, trash and deletion isolation. They do not prove device background continuity.

Focused tests: activity-distance-policy, run-model, pace-quality-baseline, sqlite-lifecycle:
39 passed. Typecheck and Lint passed (an unused test import was removed afterward).
An initial test attempted direct removal before trashing; the existing safety guard correctly
rejected it. The test now uses trash then deletion; no product deletion guard was changed.

## Remaining implementation

1. Native durable ownership/leases and legacy draft reconciliation, independent TOP settings/routes (#99).
2. Generic non-history measurement (#100), followed by Cycling's fixed DB/settings/service/UI (#101).
3. Profile-aware detector/voice integration (#102); read-only integrated history (#103).
4. Full integration, independent reviews and Test APK (#104).

No Issue is complete based on this increment. No device acceptance, installation or Production
delivery has occurred. Test v38 and Issue #93 remain separate and unchanged.
