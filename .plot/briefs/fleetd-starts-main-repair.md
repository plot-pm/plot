## Implementation brief — a-red-default-branch-is-repaired (wave: main repair start)

- **Plan (canonical):** [docs/plans/2026-10-29-a-red-default-branch-is-repaired.md](../../docs/plans/2026-10-29-a-red-default-branch-is-repaired.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2910 merged
- **Branch:** `feature/fleetd-starts-main-repair` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `#2900`'s `startReview` — this slice is itself one of the two slices that start it

Waits on `feature/role-agents-start-detached` (#2956, merged) and `feature/fleetd-reviews-slice-prs` (#2958, merged) — both are already on `main`, so this branch has nothing left blocking it. It also reads `feature/the-repair-record` (#2936, merged), which this slice must not re-derive.

### What to build

`redMainStep` (`packages/domain/src/rules/repair.ts:237`) already answers `start-repair` once a red episode's first re-run comes back red. Nothing currently *acts* on that answer: there is no re-run operation on `Host`, nothing starts the `main-repair` role, and nothing opens or reviews its fix PR. This slice is the caller that drives the rule's `await-rerun` → `start-repair` → `await-repair` arc end to end:

1. On a newly-written (or newly-read) repair record with `rerun: 'none'`, re-run the first red SHA's failed jobs once, through a new `Host` operation.
2. Once that re-run settles red (`redMainStep` now answers `start-repair`), claim the deterministic branch `bug/main-repair-<last-green-sha12>` and start the `main-repair` role (`.claude/agents/main-repair.md`, already built by #2898) detached in a worktree fleetd creates.
3. When the role's fix PR appears, start its review through `startReview` (`packages/domain/src/adapters/review-start/review-start-node.ts:107`).

### The decisions the plan settles — do not re-derive them

**The re-run operation is a new `Host` port method, built here.** `packages/domain/src/ports/host.ts` has `prCreate` (`:313`) and `pr-list`/`pr-create`/`pr-merge`/`pr-ready` in `plot-host.sh` (`:4410-4482` per the plan's measurement) — there is no re-run-jobs call on either side today (verified: `grep -n "prCreate\|rerunFailedJobs\|prClose\|prRerun" packages/domain/src/ports/host.ts` finds only `prCreate`). Build it on both drives (GitHub and Bitbucket), behind `plot-host.sh`, and route every call through it — never a direct `gh run rerun` / equivalent from fleetd code. `scripts/check-host-cli-callers.sh` gates this: it is the one place that may talk to the host CLI.

**The claim is the same mechanism `agent-loop.ts` already uses, not a new one.** The push of an empty `plot: claim <branch>` commit (`packages/domain/src/workflows/agent-loop.ts:723-724`, judged by `claimTip` in `packages/domain/src/rules/claim.ts:40`) is what makes a second machine's attempt lose — its push is not a fast-forward. Reuse this, pointed at `bug/main-repair-<last-green-sha12>`, rather than inventing a second claim shape for the repair role. The branch name is deterministic (derived from the record's `lastGreenSha`, truncated to 12 hex), so two machines racing the same episode name the same branch and only one push wins.

**`main-repair.md` and its per-role settings are already built — this slice does not touch `.claude/agents/`.** #2898 (`feature/role-agents-start-detached` and `feature/role-agent-definitions`) built the role file and the worktree-isolation settings; both are merged. What this slice adds is fleetd's *caller* — creating the worktree, starting the role in it, and reacting to what it produces. Confirm `.claude/agents/main-repair.md` still reads as it did at measurement time (deny push-to-main, deny merge, deny editing `.claude/**`/`scripts/check-*.sh`/`.github/workflows/**`, no `Fixes #N` in its commit messages) before building on it — do not assume the file unchanged.

**One repair attempt per episode, and the bound never pauses for it.** `redMainStep` already encodes this: `repairing` with no attempt recorded answers `start-repair`; with an attempt in flight it answers `await-repair` until the bound passes, then moves toward `revert` regardless of whether the fix PR is still in review (`packages/domain/src/rules/repair.ts:262-263`). This slice's caller must not add its own "wait for the PR" loop that competes with that — the bound is read from the record's `redSince`, computed by the rule, not re-implemented here.

**A HIGH on the fix PR ends the attempt (C5), it does not loop back to a second fixer pass.** This is an explicit exception to the normal correction flow (#2903's fixer): a HIGH finding on `bug/main-repair-*` skips the fixer and leaves the episode to reach the bound and revert. Likewise red CI on the fix PR ends the attempt. Neither should route through whatever correction-retry path other slice PRs use.

**fleetd asks the host before opening the PR, and treats `unaskable` as a hold — never a reason to retry blindly.** `pr-list --branch <name>` first (never the PR index — the index never says "no PR exists" for exactly this reason, per the plan's "A Decision Reads The Index" section), then `Host.prCreate` (`packages/domain/src/ports/host.ts:302`). This is the same shape #2900's `startReview` and the plan's step 7 already specify; it is not new judgment, just don't skip the `pr-list` read because `prCreate` would also "just work."

**The merge exception is NOT this slice's concern.** `feature/merge-admits-the-repair-pr` owns the narrow exception in `merge()` and `slicePrNext` for the PR this repair record names. This slice opens the fix PR and starts its review; it does not change `merge()` or `slicePrNext`, and it does not need to — the fix PR merges through the ordinary review-and-green-CI path like any other PR, since nothing about *opening* a fix PR requires the red-main merge exception. Only `revert` (the sibling slice `feature/a-red-main-is-reverted`) and a repair PR that has to merge *while main is still red* depend on that exception.

**`Main repair bound`'s parser already exists.** `mainRepairBoundMsOf` is at `packages/domain/src/rules/default-branch.ts:248`, built by `feature/the-repair-record`. This slice reads the parsed milliseconds value as an input to `redMainStep`; it does not write a second parser. The `## Plot Config` key itself (`Main repair bound`, default 3600) is not yet in this repo's `CLAUDE.md` — add it when this slice lands, the same way `Checks wait` is documented.

### Done when

The plan's `## Done when` is implicit in its Design section 7 ("Fix forward") and the Decisions list — there is no separate `## Done when` heading in this plan, so treat Design step 7, the C5 decisions, and this plan's own slice line as the specification:

- The first red SHA's failed jobs are re-run exactly once per episode before any agent starts (verified by a fleet unit test: a crash after the record write starts no second agent, named in the plan's Notes for this slice).
- A green re-run ends the episode with no agent (already true at the `redMainStep` level — this slice's caller must not start the role when the rule answers anything other than `start-repair`).
- The claim push happens *before* the worktree is created and the role started — never after. A lost claim push (another machine won) must start nothing on this machine.
- The fix PR, once opened, gets its review started through `startReview` — not through `gh pr create` plus some ad hoc review trigger.
- `redMainStep`'s `repairing`/`await-repair`/`start-repair` transitions are driven by the rule's answer on every pass, not shadowed by separate state this slice invents.

Plus: the repo's gates — build artifacts (no committed `board-server.mjs` diff), a changeset naming `plot` or `@plot-pm/board`, and the usual TypeScript/domain gates. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps changed paths to the right suites (`packages/domain/**`, `packages/fleet/**`) and the gate tests. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds a new `Host` operation on both drives — if that touches `plot-host.sh` (a `.sh` file), the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;`/`&&` is not a payment.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the branch shows activity.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/fleetd-starts-main-repair` under `### Main repair start`).

### Scope guard

This branch owns: the new `Host` re-run-jobs operation (both `ports/host.ts` and `plot-host.sh`, gated by `scripts/check-host-cli-callers.sh`), the fleetd-side caller that drives `redMainStep`'s `await-rerun`/`start-repair`/`await-repair` arc, the worktree creation and detached start of the `main-repair` role, and the claim push onto `bug/main-repair-<last-green-sha12>`.

It does not own: the repair record itself, its lifecycle transitions, `redMainStep`, or the breaking-commit picker (all `feature/the-repair-record`, merged); the merge exception in `merge()`/`slicePrNext` (`feature/merge-admits-the-repair-pr`, a sibling slice, currently blocked on this one via `waits: feature/fleetd-merges-one-at-a-time` — unrelated to this branch's own dependencies); the revert, close-PR operations, or the ticket writer (`feature/a-red-main-is-reverted`, the other sibling, waiting on `feature/an-unfixed-high-is-ticketed`); and `.claude/agents/main-repair.md` itself (#2898, merged already).

`feature/a-red-main-is-reverted` is the other branch in this plan still open; it shares no files with this slice's scope (revert/close-PR port operations vs. this slice's re-run operation and role-start caller) but both read the same repair record and `redMainStep` answer, so a late-landing change to either rule's shape is worth flagging to the other branch's implementer rather than resolving unilaterally.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
