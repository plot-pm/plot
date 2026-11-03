## Implementation brief — the-release-pr-needs-a-person (wave 1: Review switched on)

- **Plan (canonical):** docs/plans/2026-11-03-the-release-pr-needs-a-person.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3070 merged
- **Branch:** `feature/the-release-review-is-switched-on` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention (`plot/review` is required on main)

Wave 1 of 2. The wave "Release guard" (`feature/the-release-checks-are-counted`, `feature/the-release-head-is-the-version-step`) waits on this PR's merge. The CI mechanism is not a slice of this plan; it moved to #3073.

### What to build

On 2026-11-03 release PR #2934 got no review from fleetd (issue #3065). `registryd-main.ts:3071` passes `readAutoReview(boardOpts).autoReview` to `releaseTick`, and `release-tick.ts:118` starts the release review only `if (step.step === 'review' && reviewEnabled)`. `auto-review.ts:55-57` reads an absent `Auto-review` key as off, and this repository's `## Plot Config` has no such key. fleetd's logs hold 35 to 53 `release preparing: review` lines and no review started. The skipped branch writes no run-log line, and the fleetd line reads as if a start happened.

Three changes:

1. Add `- **Auto-review:** true` to `## Plot Config` in `CLAUDE.md`, then run `./scripts/check-agents-md.sh --write` so `AGENTS.md` follows. The key also turns on fleetd's review of every slice PR; the plan (Decision 1) accepts that, because the sprint goal needs it.
2. In `releaseTick` (`packages/fleet/src/shared/release-tick.ts`), when the step is `review` and `reviewEnabled` is false, append a `release-review` run-log line (`RELEASE_REVIEW_STEP`) with outcome `skipped: auto-review-off`, and return a named outcome on `ReleaseTickResult` (as `started` and `notified` are named today).
3. In `registryd-main.ts` (the `plot-fleetd: release <stage>: <step>` print near line 3103), print `plot-fleetd: release preparing: review skipped (Auto-review off)` for that outcome instead of `release preparing: review`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **No release review independent of `Auto-review`.** The person chose the config key (Decision 1). Do not add a second switch or a release-only override.
- **The review waits on CI, and that order stays.** `release-prepare.ts:256-260` returns `none('checks-…')` before the review question while the required workflow is not green on the head, so the review agent reads a tested head. Do not reorder it. A live check of this slice needs a head whose `CI` run already succeeded.
- **The notice is sent either way.** `reviewEnabled` gates only the review start; the `notify` step is unchanged.
- **Keep the skip line out of readiness.** The doc comment on `releaseTick` says no line records readiness; the new line records what fleetd did (it skipped), nothing more.
- **Absent is not false:** a missing or unreadable config reading is still off (`readAutoReview`); do not change that reader.
- **Facts are measured, not guessed:** the log line count (35 to 53) depends on which log files were read; cite the plan's figure, do not re-measure for the commit message.

### Done when

The plan's `## Design` tests for this slice are the specification, in `packages/fleet/test/unit/release-tick.test.ts`:

- "a review step with Auto-review off writes a release-review line with outcome skipped: auto-review-off" — fails today because the skipped branch writes nothing.
- "a skipped release review names itself skipped in the fleetd line" — fails today because the line reads `release preparing: review`.

Add a control: with Auto-review on, the review start and its `moved` line are unchanged. A naive implementation that logs on every `review` step, started or not, passes the first test and the control only if the control asserts the outcome is `moved`.

Plus: `CLAUDE.md` and `AGENTS.md` agree (`./scripts/check-agents-md.sh`), and a changeset exists for `plot` with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` should show no growth.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. The functions you write are arrows.

### Scope guard

Owns: `CLAUDE.md`, `AGENTS.md`, `packages/fleet/src/shared/release-tick.ts`, `packages/fleet/src/server/entry/registryd-main.ts` (the release arm's print only), `packages/fleet/test/unit/release-tick.test.ts`, one changeset. Does not touch `packages/domain/src/rules/release-prepare.ts`, `release-approve` or `merge.ts`: the two "Release guard" branches own those and start after this PR merges. No other branch of this plan is in flight (verified at brief time: `git ls-remote` finds no `feature/the-release-*` ref).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
