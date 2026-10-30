## Implementation brief — fleetd-reviews-every-slice-pr-in (wave: Review run lock)

- **Plan (canonical):** [docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md](../../docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2917 merged
- **Branch:** `feature/the-review-run-is-locked` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the head (per repo convention — the ruleset requires it since 2026-10-15)

This branch has no prior wave to wait on inside this plan: `feature/a-review-opens-no-issue`, `feature/the-index-records-the-review` and `feature/the-scope-is-read-from-git` are independent siblings already started. `feature/fleetd-reviews-slice-prs` (Review start, the next wave) depends on this one — `slicePrNext`'s review arm and `startReview` assume the lock already exists so a start can never race a second run of the same head.

### What to build

`reviewPr` in `packages/board/src/server/entry/review.ts` currently deletes a previous run's verdict and diff files (`removeFile(verdictFile)` / `removeFile(diffFile)`, review.ts:247-248) before it does anything else, and writes the final `commitStatus` (review.ts:328) with no check that a second run started in between. Two reviews of one head corrupt the first: the second run's `removeFile` calls erase the first run's verdict and diff while the first reviewer is still reading them, and because the status write is last-writer-wins per context+SHA (`host.ts:122-130`), a later run can overwrite a HIGH `failure` with `success`. A run that writes no status at all (a failed comment post, a refused verdict, a leftover worktree from a killed process) currently reads as "no review has happened" on the next pass, so every pass starts a brand-new full review forever.

This slice closes both gaps with one mechanism: an exclusive run lock per `<pr>-<sha>`, taken before the destructive `removeFile` calls and released after the status write, plus a "newest pending wins" rule so a superseded run detects it was superseded and writes nothing.

### The decisions the plan settles — do not re-derive them

**The lock file and why it reuses `slotsFile`'s technique, not a new one.** `<common git dir>/plot/state/reviews/<pr>-<sha>.lock`, holding the run's pid and run id. Write it the same way `slotsFile` claims a slot (`packages/domain/src/adapters/slots/slots-file.ts:140-168`): write the content to a temp file first, then publish the name with `link`, never a bare `wx` open. The plan states the reason as a prior measurement, not a preference — `wx` publishes the *name* before the *content*, so a second process can open the empty file and read no claim in it before the first process has written anything; `slotsFile`'s own history names six processes taking five slots against a bound of three that way. Re-deriving a different locking primitive here would reopen a question already settled by that measurement.

**A dead lock holder's lock is not a permanent hold.** `slotsFile` tests a claim's pid against the process table on every acquisition rather than trusting a timer (same file, same comment block: "a dead claimant frees its slot, measured rather than timed"). This lock follows the same shape: a lock whose pid is no longer alive is moved aside, and the take is tried once more. A leftover review worktree with no live lock owner is removed before the next start — this is the cleanup for a run that was killed mid-review and left `.worktrees/review-<pr>-<sha>` behind with nothing to ever remove it otherwise.

**"Newest pending" is read back from the host, not from local state.** Immediately after taking the lock, write `plot/review=pending` on the head with description `run <run id>` (the run id is a value this run generates once and keeps). Before the *final* status write, re-ask `Host.prReview` for the newest `plot/review` description and its time, and write the final status only while that newest pending still names *this* run's id. A run that finds a different run's id now newest writes nothing and says so in its output — it was superseded while it worked, most likely by a run started after this one's lock holder was wrongly judged dead. This is the guard that makes "last-writer-wins" safe: the last writer is now defined as the run the host currently calls pending, not whichever process finishes last.

**`PrReviewReading` must widen, and both existing callers must keep compiling against the old shape.** `host.ts:143-150` today carries only `{ sha, state, bypass }` — no run id, no time. The plan's finding #6 is explicit that "only a widened per-PR `Host.prReview` can read a run id back" — the rollup's `StatusContext` (read via `pr-list`) carries no description field at all, so a run id cannot be recovered from the bulk rollup the index reads; it has to come from this one-PR-at-a-time host call. Add the description and its time to `PrReviewReading`, and update `host-shell.ts:515`'s `prReview` implementation and its `plot-host.sh:4415` jq extraction (currently `{sha, state, bypass}` with no time or description) to carry them. **Both existing callers — `review-bypass.ts:62` and `merge.ts:280` — call `prReview` today and must not break.** Neither reads a run id or time today, so widening the interface is additive; verify both still typecheck and their existing tests (`review-bypass.test.ts`, the merge workflow's `prReview` fixtures) still pass unchanged.

**Never replace a `failure` on the same head, whoever runs it.** This is a second, independent guard from "newest pending" — it holds even when this run legitimately is the newest. A HIGH finding's `failure` status is deliberately sticky: the plan's only sanctioned ways past it are #2903's fixer/ticket flow (not built yet) or a person's `review-bypass:` comment, both outside this slice's scope. Check the *current* status on the head before the final write; if it already reads `failure` on this SHA, write nothing and say so.

**The re-status path starts no agent.** `plot-review.mjs <pr> --status-only` is a second entry mode for `reviewPr`, for exactly the case "a review ran, wrote a verdict file, but failed before or during the status write." It takes the same lock, reads the existing verdict file `reviews/<pr>-<sha>.md` through `reviewVerdict` (`packages/domain/src/rules/review-verdict.ts:27`), and runs only the status-write tail under the same two guards above (newest-pending, no-replace-failure). It does not re-fetch, re-run the agent, or re-read the diff.

**Every run takes the lock, including a person's.** No caller identity distinction is built here — that is #2898's `feature/unattended-callers-are-refused` scope, named explicitly as out of scope by D1 in the plan's Decisions. Do not add a caller check while touching this code.

### Done when

The plan's `## Done when` is implicit in its test list for this slice — there is no separate `## Done when` heading in this plan, so the slice's own test list below is the specification:

- The round-1 concurrent probe becomes a regression test: start two `reviewPr` runs against the same PR and head; the second refuses `review-running` and **removes neither file of the first** (the exact failure mode measured in the plan's finding #4 — verify by asserting the first run's verdict/diff files are untouched after the second's early refusal, not just that the second refused).
- A superseded run (its `pending` is no longer the newest by the time it reaches the final write) writes no status at all.
- No run replaces a `failure` already on the same head — assert this even when the replacing run is itself the newest pending.
- A lock with a dead pid is moved aside and the next run's take succeeds (fake/inject the pid liveness check in the test rather than killing a real process).
- `--status-only` writes the status matching the verdict file's counts and starts no agent — assert the agent-run dependency is never invoked in this path.

Plus the repo's standing gates: no committed board bundle diff (`scripts/check-no-bundle-diff.sh`), the changeset describing this change, and `scripts/check-shell-lines.sh` if any `.sh` file changes (none should, for this slice — this is TypeScript-only work in `packages/board` and `packages/domain`).

**Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints** — it resolves to the tests that name your changed files, the related tests and typecheck of the touched package, and the gate tests and `scripts/check-*.sh` scripts. Do not run the full `CI suites` list (`pnpm run test:e2e`, etc.) locally; those are CI's job. In particular do not run `pnpm run test:e2e` — it dispatches real workers into sandbox repos and is bounded by CI's `timeout-minutes`, not meant for a local loop.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Push the first real commit as soon as it exists — do not wait for the slice to be complete before the first push. Once the PR is opened, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `Review run lock` heading) so the plan stays current without relying on `/plot-deliver`'s back-fill.

### Scope guard

This branch owns:
- `packages/board/src/server/entry/review.ts` (the lock, the newest-pending and no-replace-failure guards, the `--status-only` mode)
- `packages/domain/src/ports/host.ts` (`PrReviewReading` widened with description + time)
- `packages/domain/src/adapters/host/host-shell.ts` (the `prReview` implementation reading the widened fields)
- `skills/plot/scripts/plot-host.sh` (the `pr-review` jq extraction carrying description/time — **a `.sh` change; account for it against `check-shell-lines.sh` if it grows the line count**)
- A new lock-file helper, if factored out rather than inlined — there is no existing `rules/review-lock.ts` or similar; whether this belongs beside `slotsFile` as a reusable primitive or stays local to `review.ts` is this slice's call to make, not a pre-decided answer in the plan.

Other branches in flight on this plan, verified at dispatch:
- `feature/a-review-opens-no-issue` (#2928) — owns `rules/review-issue.ts` and the findings-comment path in `review.ts` (the `prComment`/`findingsMarker` block, review.ts:306-325). **Overlaps the same file.** That slice touches the issue/comment logic in the middle of `reviewPr`; this slice touches the start (removeFile/lock) and end (status write) of the same function. Expect a merge conflict in `review.ts`, not a logic collision — read the other branch's diff before resolving it by hand, and re-run this slice's regression tests after the merge.
- `feature/the-index-records-the-review` (#2939) — owns `PrIndexRow` and `pr-refresh.ts`; does not touch `review.ts` or `host.ts`'s `prReview`. No expected overlap.
- `feature/the-scope-is-read-from-git` (#2948) — owns `sprintScope` and the sprint-reading adapter; no file overlap expected.

If you find something the plan did not anticipate — e.g. the `--status-only` mode needing a CLI arg-parsing change in a part of `review.ts` not named above — report it rather than improvising outside scope.
