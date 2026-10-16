## Implementation brief — fleetd-scan-cost-and-read-cadence (slice 3 of 5)

- **Plan (canonical):** docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1862 merged
- **Branch:** `bug/the-settled-walk-survives-a-burst` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` required check, per `docs/review-status-rollout.md`

This slice is independent of the other four — the plan's Notes say slices 1–3 (cost/cadence) and slices 4–5 (read-path correctness) are each independent within their group, and a dispatch may start all five at once. Two siblings (`bug/the-cold-scan-converges`, `bug/the-tick-asks-nothing-for-an-ended-desk`) already carry `Started:` records; this one does not yet.

### What to build

Fix tracker issue #1582: the settled-CI walk in `packages/domain/src/rules/default-branch.ts` and its caller `settleBehindHead` (`packages/fleet/src/shared/default-branch-refresh.ts:90-107`) can stall behind a burst of fast-landing commits. Measured 2026-10-11: 11 commits landed in 21 minutes while one CI run took 18–21 minutes to conclude. `ancestorsToAsk` (`default-branch.ts:120-129`) caps what one refresh asks at `ANCESTOR_ASKS_MAX = 5` ancestors, newest first, between the head and the previously settled commit. When more than 5 commits land between refreshes, the walk's 5-newest-first window never reaches far enough back to find a concluded commit, every ask comes back `pending`, and `ancestorStep` (`:144-147`) returns `'older'` for all 5 without ever returning a new `SettledReading` — so `settleBehindHead` falls through its loop and returns `kept` unchanged. The hold on the previous settled reading persists even though an older commit in the unasked tail may already be green.

A second, unrelated flake rides on this slice because the plan bundles it with #1582: `test/reconcile/sandbox-scrubs-repo-root.test.mjs`'s `finally` block (`:141-145`) races a still-exiting detached worker. The test dispatches `plot-dispatch.sh --offline --restart feature/scrub` with `Worker command: true` (line 83, 126), which launches a detached process; `rmSync` on the temp root (`:144`) can run before that worker has finished exiting inside the tree it's deleting, intermittently leaking a `plot-scrub-*` entry that `scripts/owned-run.sh`'s leak check (see CLAUDE.md `test:contracts` section) then reports.

### Decisions this plan settles — do not re-derive them

**The open question is HOW to widen the walk, not WHETHER to.** The plan's Open Questions list this unresolved: *"does the burst fix walk by completed-run listing (one host call) or by remembered pending answers (no new call, extra state)? Measure calls per refresh for each before choosing."* Two live options, both compatible with the existing shape:

1. **One listing call** — ask CI for a list of completed runs on the branch (not per-SHA) and intersect with the first-parent line, replacing N per-SHA asks with 1 list-and-filter. Changes `world.build`'s surface (a new `BuildPort` method alongside `runsForSha`).
2. **Remembered pending answers** — persist which ancestors already answered `pending` across refreshes (extra state on `DefaultBranchReading` or a parallel store) so the next refresh's window starts past them instead of re-asking the same 5 and stalling in place.

**Measure calls per refresh for each before choosing** — this is the plan's own instruction, not a suggestion to skip. Do this first, before writing the fix, and record the measurement in the PR description so the choice is traceable.

**`ANCESTOR_WALK_DEPTH = 50` (the local git walk) is not the bottleneck and is not in scope to change.** The local `firstParentLine` walk already looks back 50 commits for free — it's `ANCESTOR_ASKS_MAX = 5` (the CI-ask budget per refresh) that's too narrow for an 11-commits-in-21-minutes burst. Raising `ANCESTOR_ASKS_MAX` outright is the naive fix and is exactly what the two options above are meant to avoid: a fixed-but-larger number still stalls on a bigger burst, the same way a fixed first-scan budget (resolved separately on `bug/the-cold-scan-converges`, see that plan slice's Open Question) converges but never guarantees completion. Pick a mechanism that scales with the burst, not a bigger constant.

**`ancestorStep`'s `'stop'` behavior on a host answer failure is correct and out of scope.** `state === null` (`:145`) already means "the host did not answer," and stopping there — keeping the previous settled reading rather than guessing — is deliberate per the function's own doc comment: *"the commit the host did not answer for may be red."* Don't weaken this to keep walking past a failed ask; the burst fix must still refuse to settle on an unanswered gap.

**Rules carried over unchanged, worth restating because this slice reads the same reading other code depends on:**
- **Only a terminal answer is read from any index this slice touches.** If the listing-call option is chosen, a completed run is terminal (`red`/`green` per `foldRuns`); a `pending`/`queued`/`in_progress` one is not and must not be cached as if it were (CLAUDE.md § "A Decision Reads The Index" — "Answers, never verdicts").
- **`settledRed`/`defaultBranchRed` read only the settled part, never `reading.head`.** Whatever mechanism this slice adds must still advance `settled` through `advanceSettled`/the new walk — not bypass it by writing `head` state directly, which would desync the status-panel text (`defaultBranchStatus`) from the merge-queue hold (`defaultBranchRed`). Both must keep reading the same reading, per `default-branch.ts:263-266`'s own comment.

### Done when

The plan's `## Changelog` line for this slice is part of: *"The fleet scan completes on a repository whose cold first scan exceeds 90 s, and the tick spends host calls only on desks that can release."* (The first half is slice 1's; this slice doesn't need the cold-scan fix, only its own half of #1582.) Specifically:

- A new test in `packages/domain/test/default-branch.test.ts` or `packages/fleet/test/unit/default-branch-refresh.test.ts` reproduces the burst: more than `ANCESTOR_ASKS_MAX` commits land between a green settled commit and a pending head, and the refresh still finds and settles on an older green commit within the burst — not just the 5 newest. Neither test file has this case today; confirm before writing it that it's genuinely new coverage, not a rename of an existing case.
- A red-head-over-green test: a settled `green` commit followed by a newer `red` head settles to `red` (via `advanceSettled`, not the ancestor walk — the head itself concluded) — the plan explicitly calls out that "no test pins a red head over an older green" today.
- `test/reconcile/sandbox-scrubs-repo-root.test.mjs`'s flake is closed per [[detached-worker-pid-tests-need-a-launch-time-sentinel]]-style fix: don't assert liveness via `ps`/timing races in the `finally`; either give the `finally` a bounded wait on the worker's own pid (captured at launch, not a process-name scan — see [[wait-on-your-own-pid-not-a-process-name]]) before `rmSync`, or make the dispatched worker's exit synchronous enough that the race can't occur. Verify the fix by running the test standalone multiple times, not by reasoning about it — this class of flake only shows under contention.
- Whichever of the two options (listing call vs. remembered-pending) is chosen, the call-count claim from your own measurement is written into the PR description, and the doc comments on `ancestorsToAsk`/`settleBehindHead`/`ANCESTOR_ASKS_MAX` in `default-branch.ts` are updated to describe the new behavior — these are TSDoc blocks stating current behavior, not the history of the decision (CLAUDE.md § "The Domain Package" — factual API documentation, reasoning goes in the plan/commit).

Plus the repo's standing gates: no `State:` line hand-edited (this slice touches no plan phase). If the fix adds a new `BuildPort` method or new persisted state, run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and the domain's related vitest — both are in the local-checks output below. New or rewritten functions inside `packages/domain/src/**` are arrow functions, not declarations (CLAUDE.md § "The Domain Package").

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related tests and typecheck for exactly the files this branch touches. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR; don't run the full suites locally as a matter of course — a failure there comes back as a correction, and `test:e2e` in particular is CI's gate, not a local one (CLAUDE.md § Testing).

Name the shell gate too: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice's fix is expected to land in `packages/domain` and `packages/fleet` (TypeScript, not counted against the ratchet) and in the `.test.mjs` flake fix (also not `skills/`-shell) — but if anything spills into a `skills/plot/scripts/*.sh` file, pay for the growth in the same change.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the plan's slice line as title, the plan and this brief in the body. Push the first real commit as soon as it exists — don't wait for the measurement, the fix, and the flake repair to all be done before the first push.

### Scope guard

This branch owns `packages/domain/src/rules/default-branch.ts`, `packages/domain/src/entities/default-branch.ts` (only if new persisted state is needed), `packages/domain/src/ports/build.ts` (only if a new listing method is added), `packages/fleet/src/shared/default-branch-refresh.ts`, and `test/reconcile/sandbox-scrubs-repo-root.test.mjs`.

Other branches in flight on this plan, verified at dispatch time:
- `bug/the-cold-scan-converges` (slice 1, `Started:` recorded, PR `→ #1892` open) — touches `packages/fleet/src/shared/fleet-scan.ts`, not this slice's files.
- `bug/the-tick-asks-nothing-for-an-ended-desk` (slice 2, `Started:` recorded, PR `→ #1905` open) — touches `registryd.ts`, `registryd-main.ts`, `worker-loop.ts`, `agent-loop.ts`; no file overlap with this slice.
- `bug/the-design-commit-key-matches-a-real-plan` (slice 4) and `bug/the-issue-index-writes-at-on-an-answer` (slice 5) — different packages (`design-work.ts`, `issue-refresh.ts`, `IssueIndexSchema`), no overlap.

No sibling branch touches `default-branch.ts`, `default-branch-refresh.ts`, or the sandbox-scrub test — this slice has the files to itself.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
