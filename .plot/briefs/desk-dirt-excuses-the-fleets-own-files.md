## Implementation brief — reports-name-their-cause-and-ci-selects-their-tests (slice: Desk dirt)

- **Plan (canonical):** docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3611 merged
- **Branch:** `bug/desk-dirt-excuses-the-fleets-own-files` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the repo's review channel (`Review: pr`)

The five slices are independent and no slice waits on another. This one fixes #3144. It owns only the desk-dirt files below.

### What to build

A merged desk that holds `.plot-worker.limited`, `.plot-worker.log.1` or `.plot-worker.continue.lock` stays kept by `plot-reap` with `uncommitted: ?? <name>`, in any repository whose `.gitignore` does not name them. `plot-reap` also prints two rows for one desk whose worker is alive: `keep … worker alive` from the worktree kind, then `keep … owner: <owner>` under `-- dirty trees nobody owns --` from `runDirtyKind`. Three changes fix this:

1. `desk_dirt` (`skills/plot/scripts/plot-desk-dirt.sh:135-141`) excuses the three names as whole untracked lines (`?? .plot-worker.limited`, …), inside the existing `printf` list, so the shell line count does not grow. Update the header comment at `:59-64` to state the decisions and to say that the `.log.1` excuse is defensive: no code on `main` writes that file.
2. A held continue lock becomes a reap refusal. `TreeReadings` (`packages/domain/src/rules/reapable.ts:27`) gains `continueLock: { held: true; pid; expiresInMs } | { held: false }`, and `firstReapRefusal` (`:180`) gains `continue-lock-held`. The worktree kind (`reap.ts`, beside `worker alive (pid …)` at `:993-998`) prints `keep … continue lock held by pid <pid>, expires in <n> s`.
3. One row per desk. `runDirtyKind` (`packages/board/src/server/entry/reap.ts:1517`) takes a fourth parameter, the set of tree paths `runWorktreeKind` printed a row for, and `runReap` (`:1646`) passes it. A domain function `dirtyTreeRow(owner, reported)` beside `dirtyTreeOwner` (`packages/domain/src/rules/sweepable.ts:323`) answers `skip` for a reported path, `owned` for an owned one and `leftover` for `nobody`. Owned rows print under `-- dirty trees with an owner --`, and `-- dirty trees nobody owns --` lists `LEFTOVER` rows only. The `dirty_trees=` footer still counts `LEFTOVER` rows only.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

- **The lock's own leftovers stay dirt.** `.plot-worker.continue.lock.guard` (`continue-lock.ts:155`), `<lock>.<pid>.tmp` (`:84`) and `<guard>.<pid>.stale` (`:113`) exist only while a take runs or after a take crashed. A crashed take is a case for a person, so the desk stays kept. Excusing the prefix `.plot-worker.continue.lock*` is the obvious shortcut, and it is wrong for this reason. `desk_dirt` is deliberately narrow: it sits in front of `git worktree remove --force` and deletes whatever it excuses. Excuse names, never a prefix.
- **A nested `docs/.plot-worker.limited` still reads dirty.** The excuses are whole lines `?? <name>` at the desk root.
- **The excuse alone serves reconcile section 21.** Section 21 reports and removes nothing. The held-lock refusal belongs to the reaper only. `desk_dirt` excuses the lock file, so without the refusal the reaper would reap a desk whose continuation still runs.
- **No second reader of the lock file.** `packages/fleet/src/shared/continue-lock.ts` exports `continueLockHolder(worktree, deps)`, built from the private `readLock` and `holdingRecord` (`:56`, `:66`), which already compose the file read, `decodeContinueHolder` and the process probe with `CONTINUE_LOCK_BOUND_MS` (`:33`). The reaper reaches it through a new `Trees` port method `continueLock(path)` (port `packages/domain/src/ports/trees.ts`, beside `dirtyPathsWithStatus` at `:119`), whose adapter calls that helper. The adapters are `trees-git.ts` and `trees-fixture.ts`. The board already imports `@plot-pm/fleet/shared/*`. The domain keeps its purity gate: outside `adapters/` it imports `zod` and nothing else.
- **An unparseable or empty lock body holds nothing.** `decodeContinueHolder` returns `null` for it (`packages/domain/src/rules/continue-lock.ts:77`), and `takeContinueLock` already replaces such a lock. An expired lock and a dead holder are `held: false` too. A read error other than a missing file answers unread, and the reaper keeps the desk with `continue lock unread`. Absent is not false: unread never reads as `held: false`.
- **The domain takes readings as values.** `reapable.ts` imports no port. The adapter reads, the controller passes the reading in. Write new functions as arrows (`export const f = (…) => …`). TSDoc states what an export does, its parameters, its return and its failure, with no decision history. The reasoning belongs in the commit message.
- **Why the old test proved nothing.** "the full file set of a dead worker reads clean" (`test/reconcile/desk-dirt.test.mjs:215-225`) sets no `core.excludesFile`, so a global ignore rule makes it pass with no check made. The per-name test at `:196` does set it.

### Done when

The plan's slice-3 test list is the specification:

- `test/reconcile/desk-dirt.test.mjs`: one test per name (a merged desk with only that file reads clean, with `core.excludesFile /dev/null`). A nested `docs/.plot-worker.limited` still reads dirty. The guard, tmp and stale files each still read dirty. The full-file-set test sets `core.excludesFile /dev/null`, adds the three names, and **first asserts that `git status --porcelain` lists every file as `??`**. That assertion catches an environment whose ignore rule hides the files and makes the test pass with nothing checked.
- `packages/domain/test/reapable.test.ts`: `continue-lock-held` for a held lock. No refusal for an expired lock, a dead holder or an unparseable body (all `held: false`). The unread answer keeps the desk.
- `packages/board/test/unit/reap-worktree-kind.test.ts`: the row text for a held lock and for an unread lock.
- Domain tests for `sweepable.ts`: one cell per `dirtyTreeRow` answer.
- `packages/board/test/unit/reap-dirty-kind.test.ts:111`: rewritten, so the owned `keep … owner: a.json` row sits under `-- dirty trees with an owner --`, and a reported path prints no row.
- `test/reconcile/sweep.test.mjs:652` ("a dirty tree a live worker owns is not a leftover"): the desk's path appears in exactly one row of the run, and `dirty_trees=0` still holds. This catches a fix that hides the second row without removing it. The other `dirty_trees=` assertions (`sweep.test.mjs:645-776`, `reap-agent-liveness.test.mjs:452,459`) stay unchanged. If one of them changes, stop and report.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and not `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-desk-dirt.sh`: the three excuses go inside the existing `printf` list and add no line. A comment edit that grows the file must be paid for in the same change. The gate counts commands, not lines, so joining statements with `;` or `&&` pays nothing. The gate stores no number and has no override.

Changesets: this slice changes shipped shell (`'plot': patch`) and packages (`'@plot-pm/board'`). Write one changeset per package. Put the description first and the `bumps:` block last. Run `./scripts/check-changeset-packages.sh`. Run `pnpm build:board` only to test locally, and commit no bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-desk-dirt.sh`, `packages/domain/src/rules/reapable.ts`, `packages/domain/src/rules/sweepable.ts`, `packages/domain/src/ports/trees.ts`, `packages/domain/src/adapters/trees/*`, `packages/fleet/src/shared/continue-lock.ts` (the one new export), `packages/board/src/server/entry/reap.ts`, and the tests named above. The other slices of this plan touch none of these: `release-chain.ts`, `plot-host.sh` and `host.test.mjs`, `local-checks.ts`, `ci-job-map.jq` and `build.mjs`. Open `bug/*` branches on origin at dispatch: `bug/plot-host-reads-bb-rate-limit` and `bug/the-pulse-lookup-moves-into-the-domain`. Neither is known to touch these files, but verify with `git diff --stat origin/main...origin/<branch>` before you push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
