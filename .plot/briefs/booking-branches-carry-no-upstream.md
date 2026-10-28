## Implementation brief — parallel-release-calls-exhaust-their-push (wave 1: Booking branches)

- **Plan (canonical):** `docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md` on `main`
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2816 merged
- **Branch:** `bug/booking-branches-carry-no-upstream` (base: `main`)
- **Ends as:** one PR to `main`. Open it with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- **Review of the code:** a person reviews the PR. Issue #2804.

This is wave 1 of 5 and waits on nothing. Waves 3 and 4 touch other files and merge in any order. Wave 2 (`bug/the-push-lock-spans-the-booking`) comes next. Wave 5 (docs) merges last.

### What to build

Measured 2026-10-28: parallel booking worktrees fail with `error: could not lock config file .git/config: File exists`. 14 of 20 writers failed in the mechanism run, 21 of 40 `worktree add` and 13 of 19 `checkout -B` in the testability run. In the release arm this surfaces as "could not prepare a booking worktree" (`deliver.ts:841-843`), and on a retry as "retry stopped — could not reset" (`ladder.ts:202-204`). Neither message says `non-fast-forward`.

The change is two argv edits in `packages/domain/src/adapters/trees/trees-git.ts`:

- `addBranch` (`:457`) becomes `git worktree add -q --no-track -B <branch> <path> <start>`.
- `resetBranch` (`:464`) becomes `git -C <path> checkout -q -f --no-track -B <branch> <start>`.

With a remote-tracking start point, git writes `branch.<name>.remote` and `.merge` into the shared `.git/config`. A booking branch is pushed as `<branch>:<default>` and never reads an upstream, so nothing needs those keys.

### Settled decisions — do not re-derive them

**`--no-track`, not a lock around the call.** The collision happens in git's own config write, below any lock this repo owns. The change removes the collision even for writers that never meet the push lock. Slice 2 does not replace it.

**Measured with `--no-track`: 39 of 40 concurrent `worktree add` succeed.** The one failure is git's own concurrent `worktree add` race. Do not chase it, and do not write a test that asserts 40 of 40. The plan's concurrency case runs 10 and asserts 10.

**Other callers of the two methods keep working.** `addBranch` and `resetBranch` also serve desks and the loop ports (`loop-ports.test.ts`, `restart-reads.test.ts`, `trees-reads.test.ts`). A caller that passes `HEAD` or a local start point never had an upstream, so `--no-track` changes nothing for it. Grep every caller before you finish and confirm none reads `branch.<name>.merge` afterwards.

**Absent is not false.** Do not make either method answer from a read of the config. The methods still answer `answered(undefined)` on exit 0 and `failed()` otherwise.

**No change to `checkoutSync`.** It checks an existing branch out with no `-B` and creates no upstream.

### Done when

The plan's slice-1 test list is the specification:

- **A `trees-git` case against a scratch repository with a bare remote** (copy the `estate()` helper in `packages/domain/test/trees-reset-branch.test.ts`): `addBranch` and `resetBranch` from `origin/main` leave no `branch.<name>.merge` key in `.git/config`. Assert with `git config --get branch.<name>.merge` exiting 1. Run it on `origin/main` first, in a pristine worktree, to prove it fails today. A test that was never red proves nothing.
- **One concurrency case: 10 `addBranch` calls at once give 10 worktrees.** Wait for every call to settle before it removes the scratch root. Clean the scratch root by the exact path `mkdtempSync` returned.
- Domain branch coverage stays 100% for `src/!(adapters)/**`. The change is inside `adapters/`, so no new rule branch appears.

Plus: `nvm use` (Node 24) first. Add a changeset with `'plot': patch` and a `bumps:` block, plus `'@plot-pm/board': patch` if the board package is touched; copy the format from `git log -- .changeset`, description first and `bumps:` last. **Commit no built bundle** (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI. Do not run `pnpm run test:e2e`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/adapters/trees/trees-git.ts` and the tests beside it under `packages/domain/test/`. Wave 2 owns `ladder.ts`, `plot-push-main.sh` and `plot-push-lock.mjs`. Wave 3 owns `release.ts`. Wave 4 owns `deliver.ts`. Do not edit them here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
