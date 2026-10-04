# Run history trash lifecycle (#20)

Active history is completed RunRecord data with no trashedAt. Trashed history has
trashedAt (epoch milliseconds). Legacy records remain active without migration;
the existing @runjourney/runs/v1 JSON array retains every field. In-progress runs
use @runjourney/active-run/v1 and cannot be targeted by history lifecycle APIs.

RunRepository exposes getActiveRuns, getTrashedRuns, moveToTrash,
restoreFromTrash, deletePermanently and purgeExpiredTrash(now). getRuns is an
active-only compatibility alias. History, details, diagnostics and RunService
therefore exclude trash by default. Future aggregate consumers must use
getActiveRuns; Effective Run and Pace Analysis operate on those selected records.
No cross-run total-distance aggregate exists today; voice total distance is the
current session distance and remains independent.

Retention is TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000. Expiry is
trashedAt + retention <= now, including the exact boundary (not local midnight).
Normal history/trash reads and restores purge expired records. All reads,
mutations and purge operations share the repository serialization queue; purge is
idempotent and only writes when records expire. A repeated move does not reset
retention. Invalid timestamps are not automatically destroyed. Corrupt history
storage makes lifecycle operations fail without overwriting it.

History links to the separate trash screen. Detail deletion confirms the seven-day
restore window before moving. Trash displays original run date, effective distance,
wall-clock duration, trash timestamp and exact deletion date. Restore removes only
trashedAt from the same record. Raw/persisted GPS, IDs, original dates/distances,
Auto Stop/Break events, inclusion overrides, edit metadata, diagnostics and unknown
JSON fields remain unchanged. Permanent deletion requires a separate irreversible
confirmation and repository refusal for active history. Empty state is refreshed
after restore, deletion or purge.

#7 stop/break data is preserved throughout retention. #14 corrections remain
separate from lifecycle metadata; no DELETE edit operation is introduced. Future
#15 backup/import must round-trip trashedAt alongside all record data, validate
schema and deduplication, and provide explicit full-data backup access rather than
using the active-only compatibility API. Analysis exports should use active runs.
Export/import itself is outside this change.

Tests use isolated AsyncStorage mocks, never device history. Tests cover elapsed
boundaries -1ms/exact/+1ms, mixed/multiple records, idempotency, serialization,
reload/restore preservation, active/current-run protection, corrupt storage, UI
confirmation/navigation, restored legacy history and purge empty state.

Device acceptance: create a NEW short test run; History > detail > 削除 >
ごみ箱へ移動; confirm absence in History and presence in ごみ箱; restore and
confirm the same record returns. Optionally trash that test record again and
confirm permanent deletion. Never age or purge real history for testing. Issue #20
stays open until user device acceptance. Standalone Test versionCode is 7;
production versionCode remains 6. Build after committing to embed the commit hash.
