# Existing-development integration ledger — 2026-11-22

## Authority and scope

The owner authorized implementation, tests, independent review, and ordered main integration. Issue-by-issue user approval is no longer a separate gate. Independent approval, required tests, and required device acceptance remain mandatory. Production distribution and destructive changes to existing data are not authorized. Device-dependent work is held while independent work proceeds.

Cycling implementation begins only after the existing integration and regression gates are satisfied. Wear OS implementation, new personal-best functionality, external cycling sensors, cross-activity analysis, and cycling Web/cloud synchronization are excluded by the current instruction.

## Reproducible starting state

- main: `626f4bef8bc0f8f5bfa85351df38cf18e6389bee`.
- Current original workspace: `codex/goal-cues-20261109`, `f1476f7947779b0fa4aeb28a054efd44255ef0c8`. Tracked files are unchanged; 235 pre-existing untracked files are retained.
- Most advanced Test branch: `codex/sensor-diagnostics-test-20261114`, `e2738334bbbda5936d6f9be45883478b171f3e54`, clean.
- PR77 implementation APK commit: `ae9382483d4660e097b810d2a9e7a2ee4d5e0f96`; later commits include documentation.
- main is an ancestor of e273833: 145 commits ahead, 343 changed files, 24,574 additions / 419 deletions.
- PR77 itself is based on PR76's marker branch: 44 changed files relative to its parent, not the whole main difference.
- Snapshot: 47 open Issues and 18 open PRs before this integration tracking work.

No original worktree, untracked file, branch, device record, or backup is deleted during inventory. Commit ancestry and patch equivalence are supporting evidence, never acceptance evidence. Unless a main-specific path is stated, implementation references describe e273833 and are rooted under src/ (for example src/domain/review.ts and src/web/ReviewApp.tsx).

## Open PR chain

| PR | Base | Head | Status at audit |
| --- | --- | --- | --- |
| 34 | main | feature/web-cloud-analyzer | Draft; persistence/Web/production-sync foundation |
| 35 | feature/web-cloud-analyzer | feature/pace-workout | Draft |
| 37 | feature/pace-workout | codex/voice-savings-33-36 | Draft |
| 39 | codex/voice-savings-33-36 | codex/goal-finish-stop-31-38 | Draft |
| 44 | codex/goal-finish-stop-31-38 | codex/voice-recovery-40-43 | Open, not Draft; no recorded review decision |
| 46 | codex/voice-recovery-40-43 | codex/stop-diagnostics-noise-goal | Draft |
| 50 | codex/stop-diagnostics-noise-goal | codex/field-20261029-queue-voice | Draft |
| 57 | codex/field-20261029-queue-voice | codex/field-20261031-feedback | Draft |
| 59 | codex/field-20261031-feedback | codex/field-20261105-readiness | Draft |
| 63 | codex/field-20261105-readiness | codex/field-20261105-feedback | Draft |
| 67 | codex/field-20261105-feedback | codex/field-20261107-v26 | Draft |
| 70 | codex/field-20261107-v26 | codex/goal-cues-20261109 | Draft |
| 71 | codex/goal-cues-20261109 | codex/docs-flow-matrix-v28 | Draft; documents |
| 73 | codex/goal-cues-20261109 | codex/issue72-diagnostic-journal | Draft |
| 74 | codex/docs-flow-matrix-v28 | codex/voice-matrix-interactive-v28 | Draft; interactive documents |
| 75 | codex/goal-cues-20261109 | codex/pace-announcement-20261112 | Draft |
| 76 | codex/longrun-test-20261112 | codex/opencomm2-marker-poc-20261112 | Draft |
| 77 | codex/opencomm2-marker-poc-20261112 | codex/sensor-diagnostics-test-20261114 | Draft; physical acceptance outstanding |

The longrun branch contains diagnostic and PACE code, but the latest heads of PR73 and PR75 are not ancestors of it. Exact patches, final files, and behavior must be reconciled before declaring either absorbed. gh-pages and the voice design/analysis branches also contain independent work; do not discard them as duplicates.

## Issue coverage inventory

These are audit classifications, not completion or approval. The number sets are exhaustive for the 47-issue starting snapshot.

| Classification | Issues | Gate |
| --- | --- | --- |
| Implementation candidate exists | 14, 26, 31, 33, 36, 38, 41, 42, 45, 47, 49, 52, 55, 60, 61, 62, 64, 65, 66, 68, 69 | Verify full acceptance, current specification, independent review, and required physical evidence |
| Partial / missing implementation | 2, 3, 4, 5, 8, 9, 10, 11, 12, 19, 24, 25, 28, 29, 32, 40, 43, 48, 53, 54, 56, 58, 72 | Complete or explicitly retain the unmet scope; never close from feature presence alone |
| Future / excluded current scope | 13, 16, 51 | Remain open; cycling portion of 13 can become a separate Issue after the integration gate |

### Concrete incomplete areas

- Journey/Streak/map: calculation and Web UI exist in `domain/review.ts`, `domain/weekly-streak.ts`, `web/ReviewApp.tsx`, and `web/RouteMap.tsx`; Android equivalents are incomplete. Web coverage does not establish Android acceptance for Issues2/3/9/10.
- History display/grouping and analysis: Issues4/5/8 require display settings, variable analysis/pacing graph or Android aggregation not satisfied by current fixed native history and Web distance aggregation.
- EXP/gems/ranking and cheering: no completed implementation found for Issues11/12/25.
- Pace workout: single segment exists; multiple-segment editor/controller remains incomplete for Issue24. The later fixed-period PACE contract is also incomplete.
- Issues14/26: non-destructive correction/Recovery candidates exist, but large Native history editing and conflict/undo acceptance must be scoped explicitly.
- Issue28: later field results include missed bouncing stops and a running U-turn false stop. Offline candidate results are not product acceptance. Do not change running thresholds implicitly during integration.
- Issue32: native detail hierarchy and average-speed visibility need work.
- Issue58: initial-OFF rule-based PoC exists; it is not an implemented AI analysis service. No external data transfer is authorized by integration.
- Issue72: journal/cursor/seal and marker infrastructure exists, but the whole comparison/field acceptance scope is incomplete.

## Independent preliminary review: blocking findings

### P1 — production persistence compatibility

main uses AsyncStorage `@runjourney/runs/v1` and `@runjourney/active-run/v1`. The advanced branch uses `database()` / `SqliteStore` with `runjourney.sqlite` for shared code and excludes the AsyncStorage native module. Its initializer migrates SQLite versions, not legacy RKStorage. `docs/sqlite-persistence.md` deliberately describes PC rescue and explicit Import, not automatic legacy migration.

Therefore, a wholesale merge is not approved. Legacy records being physically retained does not make a blank visible history/settings/draft acceptable. Required resolution: non-destructive compatibility/explicit migration with tests, or a maintained old Production path. A release build guard can prevent accidental shipping while the compatibility work proceeds; it does not complete migration or justify Issue closure.

### P1 — approved periodic voice behavior not yet implemented

`domain/pace-workout.ts` still suppresses UNKNOWN and continuing ON_TARGET, using last-voice minimum interval. It does not implement the approved RUN-start wall-clock slots and immutable interval snapshots.

Native `RunAnnouncerService.clockTick` still has five-second expiry and busy skips. Existing informational notices still use replacement/deferred latest-state recovery. PR77's diagnostic feedback does not complete the full voice-reliability contract.

Work is separated onto `codex/voice-periodic-20261122`; Native and TS changes need one final integration review. No production deployment is implied.

### P1 — required physical acceptance remains outstanding

PR77 still needs OpenComm2 physical input, screen OFF, actual Shokz listening, four presses / two BEGIN-END pairs, ACK and sensor authentication. ADB synthetic input is separate evidence. The user may perform these later; unrelated work continues.

### P2 — inventory must not trigger retention

`getRuns()`, `getTrashedRuns()`, and some restore paths invoke expired-trash purging. Preservation uses `getBackupRuns()` or a consistent snapshot. No cleanup of verification runs through the trash UI during this program.

## Ordered work program

| Wave | Deliverable | Merge / close condition |
| --- | --- | --- |
| 0 | This inventory and integration ledger, main-based documentation PR | Independent review of factual scope; no product changes |
| 1 | Effective Production release guard and legacy-data compatibility plan/implementation | Guard behavior tested; legacy source remains intact; synthetic migrations/conflicts/failures/restarts covered; required device gates distinguished |
| 2 | Persistence, paging, backup and common RUN foundations | Exact main-facing diff reviewed, old record/settings compatibility established, source tests and required device tests pass |
| 3 | Common RUN UI/controls and approved periodic PACE/clock/audio reliability | Slot/snapshot/queue/error/finish regressions; actual device conditions where required |
| 4 | Remaining feature acceptance and Test-only diagnostics/markers | Feature-specific reviews and outstanding physical gates; deferred future Issues stay open |
| 5 | Main-wide regression and provenance reconciliation | Fresh checks on merged main, no lost branch work or original data; cycling prerequisite recorded |
| 6 | Separate cycling Issue/branch/PR from the normalized main | Only after waves above satisfy their completion gates |

No broad new feature or scope is marked deferred just because it is difficult. Issues11/12/25 and partial Android functionality remain unresolved backlog until implemented or explicitly scoped through the current instruction. The three future Issues are kept open under the stated exclusions.

## Review and closure record requirements

Each reviewed change records exact SHA/diff, tests actually run, synthetic versus device evidence, independent reviewer identity and scope, findings/fixes/re-review, remaining limitations, and approval. A separate-agent review is reported honestly and is not impersonated as a different GitHub user's APPROVED submission. Repository merge protections are not bypassed.

An Issue closes only after its actual conditions are met. Its final comment includes implementation, commits/PRs, verification, independent approval basis, residual scope, and the developer's delegated decision to close. This ledger is not blanket approval. Device-dependent Issues stay open while waiting for user actions.

## Preservation and distribution boundaries

- No deletion of branches, worktrees, untracked files, existing RUN/GPS/diagnostic/marker/trash/settings/protection data.
- No production APK installation, OTA distribution, or publication.
- Raw coordinates, routes, encryption keys, device backups, and raw diagnostic logs are excluded from GitHub and CI artifacts.
- Inventory snapshots and subsequent verification are versioned separately; old acceptance reports remain historical evidence.
- Main has no tracked GitHub workflows at the starting SHA. Recheck delivery automation before any later code merge or build.

## Initial checks

GitHub inventory and local source inspection completed. Two independent agents performed read-only backlog audit and preliminary risk review. This documentation change does not claim product-code tests or device validation. Product checks are recorded with the actual candidate they validate, not inherited from an old report.
