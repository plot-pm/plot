## Implementation brief — main-merges-more-than-one-pr-per-ci-run (wave 3: A red main names its PR)

- **Plan (canonical):** docs/plans/2026-11-17-main-merges-more-than-one-pr-per-ci-run.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3503 merged
- **Branch:** `feature/a-red-main-names-its-pr` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** `Review: pr` — the slice PR carries `plot/review`; a push that moves the head voids it, so batch fixes into one push

This is wave 3 of 4 and waits on nothing. Wave 1 (`the-settle-ignores-plot-commits`) merged as #3508, so `Refs.firstParentCommits` already carries `subject` and `settledPast` is on main. Wave 2 (`the-reading-settles-on-completion`, #3514) is independent of this one. Wave 4 (`merges-stack-two-deep`) is deferred and waits on this wave, because a stack needs attribution first.

### What to build

No red episode on main can revert today. `writeRepairRecord` (`packages/fleet/src/shared/default-branch-refresh.ts:279` on `origin/main`) writes `candidates: []` on every record, and `candidatesFromLine` (`packages/domain/src/rules/repair.ts:23`) has no production caller. `redMainPicker` (`:126`) therefore answers `unknown` for every episode, and `redMainStep` (`:278`) answers `exhausted` where it would answer `revert`. The plan's line numbers (`:202-218`) predate wave 1 and wave 2; use the `origin/main` numbers here.

Build three things on what exists:

1. **The record holds its candidates.** `writeRepairRecord` fills `candidates` with the first-parent commits in `lastGreenSha..firstRedSha`, read through `Refs.firstParentCommits(range)` (`ports/refs.ts:748`, each entry has `sha` and `subject`). `DefaultBranchWorld.refs` is `Pick<Refs, 'remoteSha' | 'firstParentLine'>` today; it gains `firstParentCommits`. With no `carried` reading there is no last green SHA, the record keeps `candidates: []` and `warn` says so as today. Rewrite the doc comment above `writeRepairRecord`, which states that candidates are written empty.
2. **`redMainPicker` names the oldest non-green candidate.** `RedMainCandidate.settledRed: boolean` becomes `runs: 'green' | 'red' | 'pending' | 'unknown'`, from `foldRuns(declaredRuns(…))` (`revert-start-world.ts:138`). The picker walks the candidates oldest first, in merge order, and skips each whose runs read `green`. At the first that is not green: `pending` or `unknown` answers `hold`; `red` answers that candidate's PR when it passes today's tests (subject names a PR, host reads it `MERGED`, `hostMergeCommit === sha`, no `State:` change). Every other shape answers `unknown`: no candidates, every candidate green, a first red candidate that is a direct push, a Plot-path commit, a `State:` commit, or a PR whose merge commit points elsewhere.
3. **The revert reads the named candidate's runs a second time.** `makeRevert` (`revert-start.ts` on `origin/main`, the block that asks `record.firstRedSha` and `reading.settled.sha`) asks one more SHA, the named candidate's, and holds when it does not fold `red`.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**"Exactly one qualifies" is replaced, not extended.** Alternative: keep the count and add stacked cases. It fails because each main commit has its own CI run and a commit's run contains every commit below it (the push concurrency group is `run_id`, `ci.yml:79`, so no run is cancelled by the next push). In a stack where PR1 breaks main, M1 and M2 both settle red, `qualifying.length` is 2 and today's rule answers `unknown`. The oldest non-green commit is the first commit whose change turned main red, so the rule names PR1. Where PR1 and PR2 break main only together, M1 settles green, M2 red, and the rule names PR2.

**`hold` on a pending first non-green candidate, not `unknown`.** A pending run is not a fact. `unknown` ends the episode at `exhausted`; `hold` makes the pass read again. Do not fold `pending` into red, and do not skip a pending candidate to a later red one: the later red commit contains the pending one's change, so naming it can revert the wrong PR.

**A first red Plot-path commit answers `unknown`, and that is correct.** A plan file can fail `check-plan-headings.sh` on push (`ci.yml:2013`), and a bundle commit can fail `main-bundles.sh main` on a non-deterministic build. The picker names no PR for either, so no innocent PR is reverted. `unknown` never reverts, and `exhaust` already notifies a person (`revert-start.ts:122-126`, `:231`). Do not add a "skip Plot-path commits" arm: slice 1's `settledPast` is for the merge hold, and a commit that turned main red is the answer here, not noise.

**No top-down revert.** The revert reverts the named merge only (`git revert -m 1`, `revert-git.ts:28`), and a conflict ends the episode at `exhausted` with a notification. Alternative: revert PR2 as well. It reverts a PR the picker did not name, against two existing rules: `unknown` never reverts, and one episode reverts once (`repair.ts:271`).

**The rules carried over from related work:** absent is not green. A candidate whose runs read `unknown`, a host call that fails and an empty runs list all fold to `unknown` or `pending`, never `green`. Measured 2026-08-27, an empty result read as "no PRs" and refused four fully merged plans. A persisted verdict is a cache git cannot reach (`Answers, never verdicts` in `CLAUDE.md`): the record stores the candidate shas and subjects, and the candidates' `runs` stay derived per pass from the host.

### Traps this brief found in the code

**`RedMainPickerAnswer` gains a third value, and two callers narrow on it.** `RedMainPickerAnswer = { pr: number } | 'unknown'` (`repair.ts:59`). `redMainStep` returns `exhausted` when `pickerAnswer === 'unknown'` (`:278`), and `revert-start.ts:260` returns `held` on `'unknown'` and then reads `pickerAnswer.pr` at `:261`. A new `'hold'` value that neither handles makes `.pr` a type error at best and an `exhausted` at worst, which turns a pending candidate into the end of the episode. `redMainStep` must answer `hold` for it, and `revert-start.ts` must answer `held`. Assert both in unit tests.

**The picker input is built only inside the revert window.** `revert-start.ts:184-198` builds `pickerAnswer` for `record.candidates` only when `inRevertWindow`, and holds the whole pass (`'held'`) if any candidate cannot be read. With candidates now populated, this runs for real: `candidate()` costs `prState`, `runsForSha` and `commitFiles` per candidate, and `Promise.all` reads every candidate, including the ones the picker never looks at after the first red. Count the host calls per pass for a 5-candidate episode and say the number in the PR. Do not add a second read path; if you stop the walk early, keep `held` for an unreadable candidate that the picker would have reached.

**The candidate order.** `candidatesFromLine` returns the line newest first, and the picker walks oldest first. Sort explicitly in the picker, or assert the order in a test with the candidates supplied in both orders. `redMainPicker` says "in any order" for its input today; keep that contract.

**`candidatesFromLine` takes `firstParentLine` plus `subjects`, while `firstParentCommits` already returns both.** Either call `candidatesFromLine` with the two lists it expects, or replace it with a function over `FirstParentCommit[]` and delete the old one. Do not leave `candidatesFromLine` as dead code beside a new function. A `forward` merge (`FirstParentCommit.forward`) carries the excluded side's content and no commit of the range's own; decide whether it is a candidate, say so in the TSDoc, and assert it.

**The second read must not undo the first.** The existing asks (`firstRedSha`, `settled.sha`) stay. The named candidate's SHA can equal one of them (a single red merge at the tip); ask each distinct SHA once, not twice.

**`settledRed` names two different things.** The candidate field is set at `revert-start-world.ts:138` and in `revert-start.test.ts:207`, and the picker's tests set it too. `registryd-main.ts:3732` calls the domain's `settledRed(reading)` over a reading, a different function: do not rename it. Change the candidate field only.

### Done when

The plan's `Done when` entry for this slice is the specification: a new repair record holds the candidates between `lastGreenSha` and `firstRedSha`; `redMainPicker` names PR1 for a stack where M1 and M2 settle red, PR2 for a stack where M1 settles green and M2 red, PR1 for a single red merge followed by a red bundle commit, and answers `unknown` for a first red Plot-path commit, a direct push, a `State:` commit and no candidates, and `hold` for a pending first non-green candidate, each asserted in a unit test; the revert reads the named candidate's runs a second time and holds when they are not red.

Assertions a naive implementation would pass without:

- Candidates M1 red, M2 red name M1's PR, not `unknown`. It catches a picker that still counts qualifying candidates.
- Candidates M1 pending, M2 red answer `hold`, not M2's PR. It catches a walk that skips pending candidates.
- Candidates M1 green, M2 red name M2, and M1 green, M2 green answer `unknown`. It catches a walk that stops at the first candidate regardless of its runs.
- A single red PR merge followed by a red bundle commit names the PR merge. It catches a picker that takes the newest red candidate.
- A first red candidate that is a Plot-path commit with a red PR merge above it answers `unknown`. It catches a picker that skips past the first red candidate.
- Candidates given newest first and oldest first answer the same. It catches an order that depends on the input.
- `redMainStep` with `pickerAnswer: 'hold'` answers `hold`, and `revert-start` returns `held`. It catches the `exhausted` trap above.
- A record written by `writeRepairRecord` for `lastGreenSha..firstRedSha` holds those commits, and a record with no `carried` reading holds none. It catches a populated record that the picker never reads.
- A second read where the named candidate's runs read `pending`, `unknown` or `green` holds the revert and starts no desk. It catches the second read that only logs.
- Mutation check: make the picker return the newest red candidate and confirm the stacked-red test fails. Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and do not run `test:e2e` locally. The domain package follows its own style: arrow functions (`export const f = (…) => …`), and TSDoc that states what an export does, takes, returns and how it fails, with the reasoning left to the commit message. A function you write is an arrow in the fleet package too. Use `Slice` and `Agent` vocabulary, never new `Wave` names in code. Do not commit a rebuilt board bundle (`check-no-bundle-diff.sh` refuses it; `main` builds its own).

Add a changeset in the package `plot`, description first and the `plan:` line inside the trailing comment block, using the plan's third Changelog line as the description (`When main settles red, fleetd collects the episode's candidate commits and names the oldest red PR merge …`). If you touch a `SKILL.md`, add the `skills:` bump for it; this slice should not need one.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice is TypeScript only and should add no shell. If you touch a `.sh` file, pay for any growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

After wave 2 merges, a person reads the plan's throughput measure (Notes › Measure) and decides whether wave 4 runs. That is not a duty of this branch; do not edit the `deferred:` marker.

### Scope guard

This branch owns: `packages/domain/src/rules/repair.ts` (`candidatesFromLine`, `RedMainCandidate`, `redMainPicker`, `RedMainPickerAnswer`, `redMainStep`), `packages/domain/src/entities/repair-record.ts` only if the candidate shape must change (it should not), `packages/fleet/src/shared/revert-start.ts`, `packages/fleet/src/shared/revert-start-world.ts` (`candidate`), `writeRepairRecord` and its `DefaultBranchWorld.refs` type in `packages/fleet/src/shared/default-branch-refresh.ts`, and their tests (`packages/domain/test/repair.test.ts`, `packages/fleet/test/unit/revert-start.test.ts`, `repair-start.test.ts`, `default-branch-refresh.test.ts`).

Other slices in flight (checked on `origin/main` at dispatch):

- `feature/the-reading-settles-on-completion` (#3514) owns `reaskIntervalMs`, `reaskDue`, the fold sites at `default-branch-refresh.ts` and `declaredRuns` in `rules/default-branch.ts`. It lives in the file you edit. Keep your edits to `writeRepairRecord`, its doc comment and the `refs` type on `DefaultBranchWorld`, and do not touch `settleBehindHead`, the interval functions or `declaredRuns`, so the two branches merge without a conflict. Its job form `CI/validate` changes what `declaredRuns` folds; the candidate's `runs` field reads through the same function, so no code of yours depends on which form is declared.
- `feature/merges-stack-two-deep` is deferred and waits on this branch. It adds `stackVerdict`, `stack-full` and `paths-overlap`; this slice adds no refusal names, and the board needs no change from it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
