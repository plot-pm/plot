## Implementation brief — the-release-head-is-reviewed-before-its-scope-is-delivered

- **Plan (canonical):** docs/plans/2026-11-27-the-release-head-is-reviewed-before-its-scope-is-delivered.md on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3753 merged
- **Branch:** `bug/the-release-head-is-reviewed-while-its-scope-waits` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention (`plot/review` is required on main)

One slice, one branch. The plan `a-release-holds-merges-while-it-waits` (PR #3746 and `bug/the-board-shows-the-release-hold`) reads readiness from `releaseStage` and takes its second round after this plan. This slice leaves `releaseStage` unchanged, so that plan's reading does not move.

### What to build

`releasePrepareNext` (`packages/domain/src/rules/release-prepare.ts`) answers `review` for a green, unreviewed release head while the sprint's scope is still unfinished.

The failure, measured on 2026-11-26: the active sprint `plot-describes-itself` held five undelivered Must Haves. Release PR #3719 at `8e1373e0f` read `validate` success from 20:55:50 UTC, fleetd ran until 22:31:26 UTC, and no review started. `.plot/logs/fleetd.log` holds 18581 lines `release waiting-scope: hold` against 21 lines `release preparing: review`. The cause is the `waiting-scope` branch of `releasePrepareNext`, which returns `{ step: 'hold', reason: 'waiting-scope' }` before the review checks, and those checks sit inside `if (stage === 'preparing')`. Release 2.37.0 merged in `waiting-scope` at 07:52 UTC on 2026-11-27, and the approval needs `plot/review` on the head, so the missing review was the part that waited for a person.

The change:

1. Extract the review checks of the `preparing` block into one function: head changes clean, required checks green, review writer trusted, no live run on the head, review absent, errored, on another head or a stale pending, and `reviewStartAllowed`. It answers `review`, `none(...)` or `hold(...)` exactly as the `preparing` block does today.
2. Call it from `preparing` and from `waiting-scope`.
3. In `waiting-scope`, call it only where the scope is read and the phases are read (`scope.read === 'scope'` and `phases !== 'unaskable'`). Everything it does not turn into `review` stays `{ step: 'hold', reason: 'waiting-scope' }`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **`releaseStage` does not change.** The board row, the approval button and `releaseHold` read it, so a changed stage moves three consumers and the next plan's tests. The review is a step answer, not a stage.
- **`waiting-scope` never answers `notify`.** The notification names the scope's changesets and an unfinished scope names a partial set (plan `[question-notify-early]`, recommended no). The shared function returns only `review`, `none` or `hold`. The notify tail stays reachable from `ready`/`preparing` only. The test "waiting-scope never answers notify" asserts it over a reviewed, green, clean head.
- **The review budget is the same `reviewStartAllowed` per head, whatever the stage** (plan `[question-review-budget]`, recommended yes). Do not add a second budget.
- **A foreign head must hold `release-head-foreign` in `waiting-scope` too, and the stage will not say it.** `releaseStage` returns `waiting-scope` at its scope test before it reads `headChanges`, so `stage === 'release-head-foreign'` never fires for a head in `waiting-scope`. A naive extraction that moves only the `preparing` block passes every other test and starts a review on a foreign head. The shared function (or the `waiting-scope` branch before it) must run `releaseHeadVerdict(readings.headChanges).read` itself: `foreign` holds `release-head-foreign`, and any other non-`clean` reading of a non-null `headChanges` holds `unaskable`, as `preparing` does.
- **The not-an-open-PR cases hold `waiting-scope`, not `none('no-release-pr')`.** In `waiting-scope`, `pr` can be `none`, `unaskable`, a non-`OPEN` state or carry no `headSha`. `preparing` answers `none('no-release-pr')` or `unaskable` there; `waiting-scope` keeps today's `hold waiting-scope`, so the notification path and the board text read what they read now. Test it.
- **The `changesets` and `log` readings gate the notification, not the review.** Today `preparing` holds `unaskable` on either before the review checks. Keep that guard in the `preparing` branch only; do not call it from `waiting-scope`, or an unreadable run log would block a review the scope has nothing to do with. If you find that this changes a `preparing` answer, the extraction is wrong.
- **An unread scope still holds.** `scope.read === 'none'` and `phases === 'unaskable'` keep today's answers (`hold waiting-scope` and `hold unaskable`). No review starts.
- **The extraction, not a copy.** A second copy of the checks drifts the first time one stage changes (plan: "the rule stays one rule"). One function, two call sites.
- **Rules carried over:** absent is not passing — `requiredChecks` `unknown` holds `unaskable`, anything not `green` answers `none(checks-...)`, and the index never says there is no review (`pr.plotReview === undefined` is `none('not-asked')`, unchanged). Read the exit code, not the emptiness.

fleetd's `release-tick.ts` needs no change: it acts on `step.step === 'review'` whatever the stage, and logs `RELEASE_REVIEW_STEP`. Confirm that by reading it; do not edit it unless a test shows otherwise.

### Done when

The plan's `<!-- tests: ... -->` list on the slice is the specification, in `packages/domain/test/release-prepare.test.ts` (its `readings` and `row` helpers build the cases). Lift these, because a naive implementation passes without them:

- **a foreign head answers `hold release-head-foreign` in `waiting-scope`** — catches the extraction that reads `stage` instead of the head verdict.
- **`waiting-scope` never answers `notify`** over a green, reviewed, clean head whose changeset list differs from the log — catches a shared tail that falls through to the notify code.
- **a reviewed head (`plotReview` success on this head) answers `hold waiting-scope`** — catches a shared function that answers `none('review-pending')` or similar out of the stage.
- **red or pending checks answer `hold waiting-scope`**, not `none(checks-red)` — catches the same.
- **an unread scope answers `hold unaskable`** and a `none` scope keeps `hold waiting-scope`.
- **a non-open or absent PR in `waiting-scope` answers `hold waiting-scope`.**
- **the 2026-11-26 readings of #3719 at `8e1373e0f`** (green `CI`, `validate` success, no review row, five undelivered slugs) answer `{ step: 'review', head: '8e1373e0f…' }`. Use the full sha from the plan or from `.plot/logs/fleetd.log`, not a short one.
- The existing `preparing` tests stay green unchanged: the extraction changes no `preparing` answer.

Plus: add one changeset for `plot` with the description first and the `bumps:` block last if you name one (`./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if it does, `scripts/check-shell-lines.sh` refuses growth, so pay for it in the same change. Write the new function as an arrow (`export const` or a module-level `const`), with a factual TSDoc block: what it answers, its parameters, how it fails, and no history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. Close the PR description with `Closes #3752` only if the repo's PR convention does so; the plan's `Issue:` field names it. State in the PR description that the two open questions resolved as the plan recommends (same budget; no early notification).

### Scope guard

Owns: `packages/domain/src/rules/release-prepare.ts`, `packages/domain/test/release-prepare.test.ts`, and one changeset. `packages/fleet/src/shared/release-tick.ts` and its test change only if a test shows the `review` step needs it.

In flight, verified at dispatch: `bug/a-waiting-release-holds-merges` (plan `a-release-holds-merges-while-it-waits`, PR #3746) builds `releaseHold` over `releaseStage`'s predicates and touches the release stage readings, the board and `mergeArm`. It does not own `releasePrepareNext`'s step logic, but both read `release-prepare.ts`; keep your diff to the step function and its helper, and do not reorder or rename `releaseStage`. `bug/a-release-no-sprint-names-books-its-changesets` is another release branch; check its diff for `release-prepare.ts` before you push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
