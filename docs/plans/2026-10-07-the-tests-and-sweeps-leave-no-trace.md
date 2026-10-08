# The tests and sweeps leave no trace

> A test run, a local check, a hygiene sweep and a board build leave nothing behind that a later reader takes for a fact: no moved default branch, no skipped test read as a pass, no finished double claim, no stale helper copy.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-release-train-fixes-what-it-found
- **Issue:** #1259, #1319, #1317, #1343, #1344
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-07, jwloka, in-session
- **Started:** 2026-10-07, jwloka, `bug/the-corpus-never-moves-origin-head`
- **Started:** 2026-10-08, jwloka, `bug/local-checks-find-tests-in-a-temp-worktree`
- **Started:** 2026-10-08, jwloka, `bug/the-sweep-counts-a-moved-claim-once`
- **Started:** 2026-10-08, jwloka, `bug/helpers-stay-out-of-the-board-package`
- **Started:** 2026-10-08, jwloka, `bug/helpers-stay-out-of-the-board-package`

## Changelog

- The refs corpus test does not write `origin/HEAD` in the shared repository, and `default_branch` refuses a symref that names `plot-corpus-pin` whether it resolves or not.
- `plot-local-checks.mjs` finds the related tests in a worktree under a symlinked `TMPDIR` on macOS.
- The reconcile sweep does not report a listing moved to another plan, or a pair of finished plans, as a double claim.
- A board build removes a helper copy that it no longer vendors, so no untracked helper stays in `packages/board/`.

<!-- Board impact: Slice 4 changes `packages/board/build.mjs` and `packages/board/.gitignore`. No change to the board server, the plan format, the plan template or the docs/plans layout. -->

## Motivation

Four tools that only check or build the repository change what later readers see:

- **A test moves the machine's default branch.** `packages/domain/corpus/refs.corpus.test.ts:219-251` re-points the shared repository's `origin/HEAD`. On 2026-10-03 an interrupted run left it on `plot-corpus-pin`, and three lifecycle pushes went there (#1259). `repair_origin_head` (`skills/plot/scripts/plot-default-branch.sh:72`) accepts the name once it resolves. Two parallel corpus runs also collide (#1319).
- **Local checks pass with no test.** `packages/board/src/server/entry/local-checks.ts:84` takes `repoRoot` from git and does not realpath-normalise the `{changed}` paths. Under `/var` against `/private/var` on macOS, `vitest related` finds no test and the check reads as a pass (#1317).
- **The sweep reports 9 double claims and none needs a person.** Section 14 of `plot-reconcile-scan.sh` counts a listing marked `deferred: moved to …` as a claim, and reports pairs where both plans are `Released`. On 2026-10-07, 3 of the 9 are moved listings and all 9 are pairs of released plans (#1343).
- **Stale helpers appear in `packages/board/`.** `build.mjs` copies every name in `vendoredScripts` to the package root and never removes a copy whose name left the list. Four copies stayed as untracked files after `b6aedfb73`, `1d4cff764` and `f60a9da75` removed their names (#1344).

## Design

### Approach

**One slice per fix, one branch per slice.** Each slice carries its own test and changeset, and a rebuild where it touches the board. The slices run in heading order, because a slice is eligible only when every prior slice has merged (`packages/domain/src/rules/eligible.ts:131-134`). Slice 1 comes first because a moved `origin/HEAD` sends lifecycle pushes to the wrong branch; slices 3 and 4 only mislead a reader.

**Slice 1, the corpus pin (#1259, #1319).** `refs.corpus.test.ts` clones the repository into its own temp directory and sets `origin/HEAD` there, or it passes the pin to its reads through an argument. It never writes a ref in the shared `.git`. `default_branch` treats a symref that names `plot-corpus-pin` as corrupt whether it resolves or not, and `repair_origin_head` repairs it.

**Slice 2, local checks in a temp worktree (#1317).** `local-checks.ts` resolves `repoRoot` and every `{changed}` path through `realpath` before it builds the commands.

**Slice 3, the sweep (#1343).** Section 14 skips a listing whose `deferred_reason` starts with `moved to`, and skips a pair whose claimant plans are all terminal.

**Slice 4, the vendored helpers (#1344).** `build.mjs` removes every `plot-*.sh` at the package root that `vendoredScripts` does not name, and logs each removal. `packages/board/.gitignore` ignores the vendored set by one pattern.

### Open Questions

None.

## Slices

### The corpus never moves origin/HEAD

- `bug/the-corpus-never-moves-origin-head` — the refs corpus works on its own clone or an injected pin; `default_branch` refuses `plot-corpus-pin` <!-- builds: a corpus pin that writes no shared ref --> → #1354

### Local checks in a temp worktree

- `bug/local-checks-find-tests-in-a-temp-worktree` — realpath-normalise `repoRoot` and the `{changed}` paths → #1385 <!-- builds: realpath-normalised changed paths -->

### The sweep counts a moved claim once

- `bug/the-sweep-counts-a-moved-claim-once` — section 14 skips moved listings and pairs of terminal plans → #1390 <!-- builds: the moved-listing filter in reconcile section 14 -->

### Helpers stay out of packages/board

- `bug/helpers-stay-out-of-the-board-package` — `build.mjs` prunes helper copies it no longer vendors; one `.gitignore` pattern <!-- builds: the vendored-helper prune in build.mjs --> → #1395

## Done when

Each test below fails on `origin/main` (`a778bda0d`) today:

- Slice 1: a corpus run leaves `git symbolic-ref refs/remotes/origin/HEAD` of the shared repository unchanged; `default_branch` with a symref to an existing `origin/plot-corpus-pin` answers the real default branch.
- Slice 2: a worktree under a symlinked temp directory prints a `vitest related` command that names the changed file's real path, and the command finds its test.
- Slice 3: a fixture with one moved listing, one pair of released plans and one live collision prints `double_claims=1`.
- Slice 4: a build with a stray `plot-gone.sh` at the package root removes it.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- 2026-10-07, direction from jwloka: the release train's open findings split by theme into four plans that run in parallel with each other, each slice as the triage on `a778bda0d` stated it; Type bug; reviewed in-session; own branches.
- The four plans `delivery-reads-one-source`, `the-fleet-loop-reads-its-runs-right`, `a-controller-owns-what-it-starts` and `the-tests-and-sweeps-leave-no-trace` replace the Draft plan `the-release-train-fixes-what-it-found`, which was never approved. Separate plans run in parallel, and the slices inside one plan run in order.
- Deliverable search, 2026-10-07:
  - Slice 1: `plot-default-branch.sh:11-38` documents two earlier `plot-corpus-pin` leaks; `repair_origin_head` at `:72`.
  - Slice 2: `realpath` is already applied to desks in `rules/desk-manifest.ts` and `rules/desk-worker.ts`, not to changed paths.
  - Slice 3: `deferred_reason` is already in the parser output and in `BranchSchema` (`packages/board/src/contract/schema.ts:106`).
  - Slice 4: nothing prunes vendored copies; `scripts/release-smoke.sh:96` tests that the vendored helpers run.
- 2026-10-08, answer to the PLOT-BLOCKED on `bug/local-checks-find-tests-in-a-temp-worktree`, direction from jwloka's operator session: #1317 does not reproduce through the entry point on this machine (macOS, git 2.55.0, Node 18 to 24), because `process.cwd()` and `git rev-parse --show-toplevel` already return the real path. Keep the `realpathSync` fix as a defensive change in the `desk-manifest.ts` pattern. Meet the "fails on origin/main" criterion at a seam: give the code that builds the `{changed}` paths a symlinked root and assert the printed path is the real path. Keep the vitest root-versus-argument fixture as evidence of the mechanism. State the deviation in the PR body and write "Refs #1317", not "Closes #1317".
