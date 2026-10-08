# Run completion summary

The existing 1.5s STOP hold calls a service that coalesces concurrent STOP calls.
After GPS stops, the repository freezes the STOP snapshot in the existing draft
storage before writing history. A failed history write leaves a retryable draft
with its original endedAt, raw GPS and events. Frozen drafts reject new GPS and
manual transitions and are not restarted as tracking sessions on restoration.
If draft cleanup fails after history was saved, retry returns the existing record
with the same ID and end time. Corrupt history is rejected instead of overwritten.

Only successful completion navigates to /run-summary with the saved record ID.
The summary reads persisted history, calculates all metrics through effectiveRun
and provides history/home links. It reports history saved only after the record
was read successfully. Read errors provide reload; STOP errors provide save retry.
Backgrounding during saving does not cancel the serialized repository operation.
Restarting with an unfinished frozen draft presents save retry on the run screen.
No advertisement SDK or independent metric calculation is introduced.

Automated tests cover all three run states, metric agreement, failures at history
write and draft cleanup, pending duplicate STOP, success-only routing, reload,
home/history routing, service concurrency and frozen-draft restoration. Android
layout, actual navigation/backgrounding and installed history retention still
require SO-51B verification.
