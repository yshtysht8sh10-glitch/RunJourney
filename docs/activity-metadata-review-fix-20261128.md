# PR #109 review corrections

Initial 3874812 received CHANGES_REQUESTED (three Major findings). Draft inspection now
checks every active slot within a strict upper bound and rejects noncanonical/extra/orphan
rows. Header types are checked via SQLite typeof before numeric conversion. Completed
history requires parseable start/end and a nonnegative, ordered duration. UTC/offset date
normalization is a query expression only, never a stored-value rewrite, before pagination.

The new metadata port does not promise support for every permissive JavaScript Date.parse
legacy string. Unsupported non-ISO history values produce a visible read failure, not epoch
zero, data removal or a fake complete summary. Existing Running's history path is unchanged.
Draft dates are still interpreted by the existing JS Date.parse contract during adoption.
Large-history expression-sort performance and zone-less/DST behavior require further tests.

Synthetic Native tests include the review's extra-slot/offset/header counterexamples and
check source bytes remain unchanged. Fixed-SHA rereview is required; no real data/device
operation or new-START acceptance is claimed.
