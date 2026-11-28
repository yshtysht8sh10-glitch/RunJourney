# PR #108 review corrections

Initial fixed 0e30cd1 received CHANGES_REQUESTED (two Major findings).
prepareFinish now awaits re-saving its originally frozen end/tail on every retry; RAM
does not imply durability. Pause flushes a received pre-boundary tail and retains that raw
snapshot on save failure. A later paused fix cannot replace an unpersisted earlier tail.

New synthetic SQLite regressions cover repeated failed final ACK, original end retention,
raw-tail persistence, failed pause/retry and final effective distance. Existing Running
thresholds, timestamp semantics and raw storage schema remain unchanged. Fixed-SHA
rereview is required; no device acceptance or Issue completion is claimed.
