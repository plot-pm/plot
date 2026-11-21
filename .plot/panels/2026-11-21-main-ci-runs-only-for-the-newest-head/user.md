# user — main-ci-runs-only-for-the-newest-head

Position: amend

## Findings

1. **A red `main` is still noticed, and sooner than today, but fleetd's revert arm stops naming the breaking PR in the common case.** Under slice 1 a pending run is replaced whenever a newer push arrives, so most commits between `lastGreenSha` and `firstRedSha` carry a cancelled run or no run. `redMainPicker` walks oldest first and answers on the first non-green candidate (`packages/domain/src/rules/repair.ts:109-121` on origin/main, opened). The plan makes a `cancelled` candidate answer `unknown`, so `redMainStep` answers `exhausted` past the bound (`repair.ts:263`, opened). With 46 of 60 commits being Plot bookkeeping (plan Motivation), the oldest cancelled candidate will usually be a bookkeeping commit sitting in front of the code PR whose run concluded red. Example: `G` green, `B1` plan booking (run cancelled), `A` code PR #N (run concluded red). Today the picker skips a green `B1` and names #N. With the plan it stops at `B1` and the episode goes to `exhausted`, so no revert of #N happens, and a person has to open a repair PR. For the person whose main turns red, automatic revert becomes rare instead of usual. The plan's Changelog presents the change only as an improvement ("no longer waits without end"). Read in plan, confirmed in code.
   **Change:** in Slice 1's "The rule change", add one of these two, and the matching `repair.test.ts` row: (a) the picker skips a `cancelled` candidate whose changed files all lie in `syncPathSet` (the set `settledPast` already trusts past a green commit, `packages/fleet/src/shared/auto-merge.ts:314-329`), and continues to the next candidate; or (b) the plan states that a cancelled candidate ends the revert arm, and gives the expected share of red episodes that will reach `exhausted` with no revert. I recommend (a). A bookkeeping commit that turned validate red reaches `exhausted` anyway when the later candidate's PR is not `MERGED` with a matching merge commit, so (a) adds no unchecked revert. The `Changelog` line must then say that the revert arm skips a cancelled bookkeeping commit and ends at `exhausted` on a cancelled code commit.

2. **The person who reaches `exhausted` is not told why.** `exhausted` is the point where `plot-ask.mjs repair-pr` is the only way forward, and after this plan it will be reached because a run was cancelled, not because a revert failed. The plan records no reason on the repair record and names no surface where the cancelled candidate's SHA shows. Read in plan.
   **Change:** add to Slice 1: the repair record names the candidate SHA that read `cancelled` when the step answers `exhausted`, with a `repair-record` unit test, so a person reading the record or the board sees which commit is untested.

3. **The operator's merge wait shrinks, and the open question `[question-cancel-in-progress]` should be answered `false`.** Today 22 runs queued and the reading stayed settled on one commit for 3 h. With `false`, at most one running and one pending run exist per group, so a red or green head settles within about two run lengths. With `true` and a 1.9-min median push gap against a run of at least 19.9 min, a head concludes only in a 20-min quiet gap (2 in 5 h), which would hold `default-branch-unsettled` longer than today. I recommend `false`. The concurrency expression and comment the plan cites hold (`.github/workflows/ci.yml:56-80` on origin/main, opened).

4. **`[question-plot-panels]`: keep `.plot/panels/` out of the set.** It is 1 of 60 commits. Adding it widens what `settledPast` trusts for every merge, for a path that gives a person no merge benefit. Keep it out until a measurement shows panel pushes holding merges. Read in plan.

5. **The references the user lens depends on hold.** `foldRuns` reads a cancelled run with nothing failed as `unknown` (`packages/domain/src/rules/default-branch.ts:97-103`), `advanceSettled` moves only on `red`/`green` (`:129-134`), `ancestorStep` passes over `unknown` as `older` (`:218-221`), `revert-start-world.ts:138` folds with `foldRuns(declaredRuns(...))`, and `unknownHeadBound` is person-only (`packages/domain/src/workflows/merge.ts:195-205`). The select steps run only on `pull_request` and every non-PR event selects every job (`ci.yml:176-224`). All opened on origin/main. Slice 2's base, the newest green push head rather than `HEAD^1`, means a bookkeeping push after an untested code merge still runs the full suite, so a red code change is not hidden behind a narrowed run. Read in plan, checked against `ci.yml`.

## What I looked at

- The plan file and the panel brief.
- `git show origin/main:.github/workflows/ci.yml` (lines 1-12, 52-130, 170-230).
- `git show origin/main:packages/domain/src/rules/repair.ts` (picker and `redMainStep`).
- `git show origin/main:packages/domain/src/rules/default-branch.ts` (`foldRuns`, `advanceSettled`, `ancestorStep`).
- `git show origin/main:packages/fleet/src/shared/revert-start-world.ts` (lines 130-142).
- `git show origin/main:packages/domain/src/workflows/merge.ts` (lines 195-205).
