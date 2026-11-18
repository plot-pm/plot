# Main merges more than one PR per CI run

> fleetd and `plot-ask.mjs merge` merge into main at least 3 PRs per hour, and `redMainPicker` still names the one PR that turned main red.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** bug-fixes-2-35-0
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3503 merged
- **Started:** 2026-11-17, Jan Wloka, `feature/the-settle-ignores-plot-commits`
- **Started:** 2026-11-17, Jan Wloka, `feature/the-reading-settles-on-completion`
- **Started:** 2026-11-18, Jan Wloka, `feature/a-red-main-names-its-pr`
- **Delivered:** 2026-11-18

## Changelog

- A commit on the default branch that changes only Plot's bookkeeping paths or the generated bundles no longer restarts the wait for a settled main. fleetd and `plot-ask.mjs merge` treat it as settled with the commit before it, while its own CI run still feeds the reading.
- The default-branch reading asks a pending head again when its CI run is expected to end, not on a fixed 5-minute interval. `Default branch checks` accepts a job form such as `CI/validate`, and the reading then folds only that job.
- When main settles red, fleetd collects the episode's candidate commits and names the oldest red PR merge whose earlier candidates are green. Before this change every repair record held no candidates, so no red episode could name a PR.
- fleetd and `plot-ask.mjs merge` merge a PR onto a default branch that carries at most 1 unsettled PR merge, when the PR's changed paths are disjoint from that merge's paths and the combined `merge-tree` is clean. New refusals: `stack-full` and `paths-overlap`.

<!-- Board impact: the board shows merge refusals by name; `stack-full` and `paths-overlap` are two new names it must render. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

Measured on 2026-11-17 from host data: main takes about 1.5 merges per hour. A merge waits until main's CI settles green on the exact tip, and main's tip moves far more often than PRs merge.

**The hold.** `merge()` in `packages/domain/src/workflows/merge.ts:366-375` refuses `default-branch-unsettled` unless main's fresh tip equals both the reading's `headSha` and `settled.sha`. `mergeAt` (`:537-564`) makes the same check before it asks `prReview`. fleetd's `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts:368-418`) holds `default-branch-unsettled` while `settled` is not green (`:405`), and holds `merge-in-flight` while `settled.sha !== headSha` or a MERGED row is newer than `askedAt` (`:408-410`). `nextMerge` allows one merge per pass.

**The wait per settle.** Main's CI takes about 21 min: `gates` 1.2, `checks` 7.5, `census-*` 12.2. `census` is not a required check, but the reading folds the whole `CI` workflow run, which ends about 5 min after `validate`. `validate` needs `select`, `gates`, `checks`, `helper-contracts` and `board-integration`, and no `census-*` job (`.github/workflows/ci.yml:2867`). The reading writer `packages/fleet/src/shared/default-branch-refresh.ts` asks a pending head again every `REASK_MS` = 5 min (`:29`), so a settle is seen up to 5 min after it happens.

**The tip moves without a merge.** Each merge moves the tip twice: `build-bundles.yml` pushes `plot: build the board artifact` about 40 s later. Direct bookkeeping pushes (`plot: record PR #N`, `plot: book the brief and plan start for …`) also restart the wait. Between 08:56 and 14:10 UTC there were about 15 such commits against 8 merges. Example: `40881e43`, pushed at 13:27, held the next merge until 14:09.

**Attribution does not work today.** Every commit on main gets its own CI run: the push concurrency group is `run_id` (`ci.yml:79`), so a run is never cancelled by the next push. `redMainPicker` (`packages/domain/src/rules/repair.ts:126`) names a PR only when exactly one candidate is a PR merge that settled red on its own runs. But `writeRepairRecord` (`default-branch-refresh.ts:202-218`) writes `candidates: []` on every record, and `candidatesFromLine` (`repair.ts:23`) has no production caller (checked on `origin/main` at `813a17f0a`). The picker therefore answers `unknown` for every episode, and `redMainStep` answers `exhausted` where it would answer `revert` (`repair.ts:277`). A stack needs attribution, so this plan builds it before the stack.

**What the hold guards.** The anti-goal in `docs/stories/archived/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:31` is "Main goes red and stays red". `:90` names the one-merge hold as the main guard against "two PRs green on an old base can be red together". Plan `2026-10-29-fleetd-merges-slice-prs-one-at.md` introduced the hold (commits `28df9fd66`, `68238382a`). The hold does not test two PRs together before the second merges: ruleset 24412719 has strict status checks off, so PR2's `validate` ran on PR2's own base, and the merge of PR2 onto a green PR1 is the first run of the two together. What the hold keeps is one cause per red: every merge lands on a base known to be green, so a red names one merge.

**The ruleset.** Ruleset 24412719 on `main` requires `validate` and `plot/review`, with strict status checks off, and it has no merge-queue rule.

## Design

### Approach

The plan raises throughput in four steps. Steps 1 and 2 make a settle cheaper and faster. Step 3 makes a red episode name its PR. Step 4 admits a bounded stack, and it runs only if steps 1 and 2 do not reach the target.

**Step 1: a commit that changes no code does not need its own settle.** A new reading, the unsettled commits, lists the first-parent commits in `settled.sha..headSha`, each with its sha, subject and changed paths. `Refs.firstParentCommits` (`ports/refs.ts:743`) reads the line, and it gains a `subject` field. `Refs.commitFiles` (`ports/refs.ts:452`, `git show -m --first-parent`) reads each commit's paths. The cost is 1 + N local git calls, with N at most `ANCESTOR_ASKS_MAX` = 5, and no host call. The caller reads it once per tick, not per PR, because it depends only on the reading.

A new pure domain rule, `settledPast(settled, unsettled, pathSet)`, answers `settled` when each unsettled commit changes only paths in the Plot path set below. `mergeArm` replaces `settled.sha !== headSha` with this answer, and `merge()` and `mergeAt` replace `settled.sha !== tip` with it. The `tip === headSha` check and the `newestMerged.mergedAt <= askedAt` check stay: they prove that the reading names the current tip and that the list includes the newest merge.

The path set is the union of two existing sets, taken from the code, never from a commit's subject or author:

- `syncPathSet` in `packages/domain/src/rules/state-sync.ts:59`: the `Plan directory`, `Active index`, `Delivered index` and `Sprint directory` values, the release records directory (`docs/releases/` by default), `.plot/briefs/` (`BRIEFS_DIR`) and `.plot/hold` (`HOLD_FILE`). This is the set a sync PR may change, and it holds every path the bookkeeping commits write: `plot: record PR #N` changes one plan file, and `plot: book the brief …` changes `.plot/briefs/<slug>.md` and one plan file.
- The generated bundle set: `build.mjs`'s `shipped*` declarations, the same list `scripts/main-bundles.sh:65` reads with `read_shipped_bundles` and `.gitattributes` marks `-merge` under `skills/plot/scripts/board/`. `build-bundles.yml` commits only these paths.

A PR merge whose paths all lie in the set (a plan PR) is settled the same way: the rule reads paths, not the commit's kind. A path with `..` segments, a rename out of the set, or an unread diff answers "not settled", so the rule fails closed the way `syncPathVerdict` (`state-sync.ts:84`) does.

Both kinds of commit can still turn main red on their own. Every test job rebuilds the bundles before it tests (`pnpm run build:board`, nine jobs in `ci.yml`), so a bundle commit's run tests the same build as the merge commit's run, except one check: `main-bundles.sh main` exits 1 on the App's own build commit when the build differs from HEAD, that is, when the build is not deterministic. A plan file can fail `check-plan-headings.sh`, which runs on push to main (`ci.yml:2013`). The rule keeps both in the set, because without plan files it removes none of the bookkeeping commits. The commit's own run still feeds the reading. A concluded red on it becomes `settled` (the settled part is the newest concluded commit, `default-branch-refresh.ts:110-133`), and `default-branch-red` holds as today. The gap is a merge admitted while such a commit is still pending, which then settles red. Step 3 bounds it: the oldest non-green candidate is then the Plot-path commit, which names no PR, so the picker answers `unknown` and reverts no innocent PR.

**Step 2: the reading sees a settle when it happens.** The refresh asks a pending head again when its run's expected end passes, computed from the run's start time and the duration of the last green runs of the same jobs, in place of the fixed `REASK_MS`. `REASK_MS` stays as the upper bound.

`Default branch checks` gains a job form `<workflow>/<job>`, and this repository declares `CI/validate`. A bare name such as `CI` keeps its meaning, the whole workflow run. The reading does not reuse `Merge checks`, for three reasons. `Merge checks` is read from the host's check rollup on a PR head (`pr.checkRuns`, through `mergeChecksVerdict` at `merge.ts:324`; passed in at `merge-ports.ts:63` and `auto-merge.ts:369`), while the reading is the CI connector's answer for a main commit (`build.runsForSha`, filtered by `declaredRuns` at `default-branch-refresh.ts:88` and `rules/default-branch.ts:41`), and the Layering Rule keeps the two connectors apart. A repository may require different checks on a PR than on main, where every suite runs. And the job form keeps every existing `Default branch checks` value valid. The cost is one jobs read per declared run asked (`/actions/runs/{id}/jobs` on GitHub Actions). A job name that the CI system cannot read as a job matches no run, `unmatchedChecks` reports it, and the reading folds it as `unknown`, never green. A `census-*` failure then no longer turns the reading red, which matches the ruleset, where `census` is not required.

**Step 3: a red episode names its PR.** `writeRepairRecord` fills `candidates` with `candidatesFromLine` over `lastGreenSha..firstRedSha`, read through the same `Refs.firstParentCommits` with `subject`. `RedMainCandidate.settledRed: boolean` becomes `runs: 'green' | 'red' | 'pending' | 'unknown'`, from `foldRuns(declaredRuns(…))` (`revert-start-world.ts:138`). `redMainPicker` changes from "exactly one qualifies" to "the oldest non-green candidate":

1. Walk the candidates oldest first, in merge order.
2. Skip each candidate whose own runs read `green`.
3. At the first candidate that is not green: where its runs read `pending` or `unknown`, the picker answers `hold`, and the pass reads again (a pending run is not a fact). Where its runs read `red`, the picker answers that candidate's PR when the candidate qualifies by today's tests: its subject names a PR, the host reads the PR `MERGED`, the PR's merge commit is the candidate's sha, and it changes no `State:` line.
4. In every other case the picker answers `unknown`: no candidates, every candidate green, or a first red candidate that is a direct push, a Plot-path commit, a commit that touches `State:`, or a PR whose merge commit points elsewhere. `unknown` never reverts, and `exhaust` already notifies a person (`revert-start.ts:122-126`, `:231`).

The rule names the culprit because each main commit has its own run, and a commit contains every commit below it. The first red commit whose earlier candidates are green is the first commit whose change turned main red. In a stack where PR1 breaks main, M1 and M2 both settle red, and the rule names PR1, where today's rule counts two and answers `unknown`. Where PR1 and PR2 break main only together, M1 settles green and M2 red, and the rule names PR2, the same answer the hold gives today. A flake on M1 is the remaining risk, so the revert reads the named candidate's runs a second time, beside `firstRedSha` and the settled sha (`revert-start.ts:342-343`), and holds when the second read is not red. This replaces the earlier claim that each stacked merge keeps its own verdict: each commit has its own run, but a commit's run includes every unsettled change below it, so only the oldest red commit's verdict is its own.

**Step 4: a bounded stack.** `mergeArm`, `merge()` and `mergeAt` admit a PR onto a tip that carries at most 1 unsettled PR merge, so at most 2 PR merges are unsettled after it lands. A new pure rule, `stackVerdict(unsettled, pr, pathSet)`, replaces the `settledPast` answer from step 1 and answers:

- `settled` where every unsettled commit lies in the Plot path set (step 1);
- `merge-in-flight`, as today, where the unsettled reading, the PR's paths or the merge-tree is unread;
- `stack-full` where the unsettled commits hold more than `ANCESTOR_ASKS_MAX` = 5 commits, or where a counted commit already exists and one more would exceed the depth;
- `paths-overlap`, naming the shared paths and the unsettled commit, where the PR shares a changed path with a counted commit;
- `admit` otherwise, when `git merge-tree` of the tip with the PR's head is clean.

A commit counts toward the depth when its first-parent diff has a path outside the Plot path set, PR merge or not. Bookkeeping commits, bundle commits and plan-only PR merges do not count. The 5-commit bound holds because the reading's walk asks at most `ANCESTOR_ASKS_MAX` commits per refresh (`rules/default-branch.ts:118`): within it, every unsettled commit was asked in the refresh that wrote the reading, and none had concluded, because a concluded commit becomes `settled`. Stacking needs `settled` green and fresh. A red, stale or unread reading holds as today, and a merge that `repairMergeVerdict` admits on a red main never stacks: it keeps today's `settled.sha === headSha` requirement.

The PR's paths come from `Refs.headChanges(row.headSha)` (`ports/refs.ts:329`) and the merge-tree from `Refs.conflictPaths(headSha, row.headSha)` (`:343`). The caller reads both only for a PR that passed every earlier hold, so the cost is 2 local git calls per such PR and no host call. `mergeArm` stays pure over readings. `nextMerge` still allows one merge per pass, and the `newestMerged` check holds the next merge until a refresh has read the new tip. The depth is a constant in the domain; this plan does not make it a config key.

**What the stack admits and what it gives up.** The stack does not reduce what is tested before a merge: with strict checks off, today's hold also merges PR2 untested together with PR1. It gives up one guarantee, that every merge lands on a base known to be green. It replaces it with: every merge lands on a green base or on at most 1 unsettled PR merge with disjoint paths. The damage of each failure shape is bounded:

- PR1 breaks main alone: step 3 names PR1, the revert of M1 applies over M2 (see the revert below), and main turns green.
- PR2 breaks main alone, or PR1 and PR2 break it only together: M1 settles green, step 3 names PR2, as today.
- PR1 and PR2 each break main: step 3 names PR1, the revert merges, and main stays red. `mergedRevertStep` answers `exhausted` (`repair.ts:307-314`) and a person repairs it, through the repair record and `plot-ask.mjs repair-pr`. This is the one shape the hold handled with two reverts and the stack hands to a person. The depth of 2 bounds it to two PRs.
- A merge lands on a main that is already red but not yet settled: covered by the first and third shapes.

Two stronger guards were considered and rejected. Stacking only a PR whose own CI ran on a base that holds every unsettled merge would keep the hold's guarantee, but nothing re-runs a PR's CI after a merge while strict checks are off, a push to update the PR moves its head and voids `plot/review` (`mergeArm` reads `plotReviewSha !== headSha` as `not-passed`), and the CI connector has no reading of which base a PR run tested. So every stacked PR would wait for a new head and a second review, and the stack would admit almost nothing. Stacking only PRs that touch disjoint packages fails because the package graph is a chain: `@plot-pm/board` depends on `@plot-pm/fleet` and `@plot-pm/domain`, `@plot-pm/fleet` on `@plot-pm/domain`, and the shell scripts and contract tests run bundles built from all three. Package disjointness then admits only a stack where at most one PR changes code, and the break it targets, two PRs that fail together, is already named by step 3 as PR2, the same answer the hold gives. The disjoint-paths and clean-merge-tree conditions stay, because they make the revert of the lower PR apply over the upper one.

**The revert of the lower PR.** `makeRevert` reverts the named merge commit on a desk at the default branch tip with `git revert -m 1` (`revert-git.ts:28`), and a conflict ends the episode at `exhausted` with a notification (`revert-start.ts:385-386`). The plan keeps that behaviour and adds no top-down revert. The first-parent diff of M1 holds only PR1's paths, and PR2 changes none of them (`paths-overlap`), so PR2 cannot make the revert conflict. Only a Plot-path commit that edits a file PR1 changed, such as `plot: record PR #N` on PR1's plan file, can, and a person then repairs it. A top-down revert would revert PR2, which the picker did not name, against two existing rules: `unknown` never reverts, and one episode reverts once (`repair.ts:271`). If PR2 depends on PR1 at run time, the revert PR's own CI reads red and `judgeRevertPr` ends the episode at `exhausted` (`revert-start.ts:302`).

### Approaches considered

- **GitHub merge queue.** Rejected. GitHub merges in place of the Merger app, so a merge bypasses `mergeAt` and its `--match-head` pinning. `plot/review` must be posted on the merge-group SHAs. The bookkeeping and bundle pushes need a bypass. Bitbucket has no equivalent, and the Layering Rule keeps the merge decision host-agnostic.
- **Train branch.** CI runs on main + PR1 + PR2, and main then fast-forwards to it. Rejected. The `pull_request` rule of the ruleset blocks the fast-forward push, and `redMainPicker` needs host merge commits to name a PR. It rebuilds a merge queue inside Plot.
- **Chosen.** A cheaper settle first (slices 1 and 2), then attribution (slice 3), then a bounded stack (slice 4). Slices 1 to 3 add no merge risk, and slice 3 is worth having alone, because no red episode can revert today. Slice 4 runs only if the measure after slice 2 stays under 3 merges per hour. A stack of depth 1 is today's rule, so the measure after slice 2 already reads it.

### Done When

Per slice, in slice order.

- *The settle ignores Plot commits:* `Refs.firstParentCommits` carries `subject`; `settledPast` answers `settled` for unsettled commits that touch only the Plot path set, and "not settled" for one path outside it, a `..` path, a rename out of the set and an unread diff, each asserted in a unit test; `mergeArm`, `merge()` and `mergeAt` merge onto a tip whose only unsettled commits are a bundle commit and a bookkeeping commit, and refuse with today's reasons for a tip with one code commit, asserted in unit tests.
- *The reading settles on completion:* the refresh asks a pending head again at its expected end, and never later than `REASK_MS`, asserted in a unit test; `CI/validate` folds only the `validate` job, a bare `CI` folds the whole run as today, and an unreadable job name reads `unknown` and is reported by `unmatchedChecks`, each asserted in a unit test; this repository's `Default branch checks` reads `CI/validate`.
- *A red main names its PR:* a new repair record holds the candidates between `lastGreenSha` and `firstRedSha`; `redMainPicker` names PR1 for a stack where M1 and M2 settle red, PR2 for a stack where M1 settles green and M2 red, PR1 for a single red merge followed by a red bundle commit, and answers `unknown` for a first red Plot-path commit, a direct push, a `State:` commit and no candidates, and `hold` for a pending first non-green candidate, each asserted in a unit test; the revert reads the named candidate's runs a second time and holds when they are not red.
- *Merges stack two deep:* `stackVerdict` answers `admit`, `settled`, `stack-full`, `paths-overlap` and `merge-in-flight` for the cases in step 4, including more than 5 unsettled commits, a plan-only PR merge that does not count, a red reading and a repair-admitted merge that never stacks, each asserted in a unit test; `merge()` and `mergeAt` refuse `stack-full` and `paths-overlap` with the same reasons as `mergeArm`; the board renders both refusal names.

### Open Questions

- [x] **Stacked red attribution can answer `unknown` by construction.** Resolved: `redMainPicker` names the oldest non-green candidate in merge order when its runs read red and it qualifies, answers `hold` while that candidate's runs are pending, and `unknown` otherwise (step 3); slice 3 implements it, with the stacked cases as tests.
- [x] **Disjoint paths plus a clean `merge-tree` do not keep the anti-goal.** Resolved: with strict checks off, the hold never tested two PRs together before a merge either; the stack gives up "every merge lands on a green base" and hands one shape, two independent breaks in one stack, to a person; base-includes-unsettled and disjoint-packages guards were rejected with reasons (step 4).
- [x] **Reverting the lower PR of a stack.** Resolved: no top-down revert; disjoint paths mean PR2 cannot make the revert of M1 conflict, and a conflict from a Plot-path commit keeps today's `exhausted` plus notification (`revert-start.ts:385-386`).
- [x] **`merge-in-flight` under a stack.** Resolved: `settled.sha !== headSha` is replaced by `settledPast` (slice 1) and then `stackVerdict` (slice 4); the `newestMerged` check stays; the unsettled commits come from `Refs.firstParentCommits` with `subject` plus `Refs.commitFiles` per commit, at 1 + N local git calls per tick (N ≤ 5) and no host call.
- [x] **Counting unsettled merges.** Resolved: a commit counts when its diff has a path outside the Plot path set, PR merge or not, so a plan-only PR merge does not count; stacking needs `settled` green and at most 5 unsettled commits, so no stack forms while a red reading is unresolved.
- [x] Does CI on main test the generated bundles in a way the merge commit's run did not? Resolved: every test job rebuilds the bundles, so only `main-bundles.sh main` on the App's build commit (a non-deterministic build) can turn a bundle commit red alone; its run still feeds the reading, and step 3 names no PR for it.
- [x] A plan-file commit can turn main red through `check-plan-headings.sh`. Resolved: yes, it runs on push (`ci.yml:2013`); the plan keeps plan paths in the set, because without them step 1 removes no bookkeeping commit, and the commit's own run still holds main red through the reading.
- [x] The config shape for job names in `Default branch checks`. Resolved: `Default branch checks` gains the job form `CI/validate`; `Merge checks` stays the PR rollup's key, because it is read from the host, not the CI connector (step 2).
- [x] Is a stack depth of 2 right, or does slice 4 measure 1 first? Resolved: depth 1 is today's rule, which the measure after slice 2 reads; depth 2 stays a domain constant.

## Slices

### The settle ignores Plot commits

- `feature/the-settle-ignores-plot-commits` — `Refs.firstParentCommits` carries `subject`; a domain rule treats unsettled commits that change only `syncPathSet` paths or generated bundles as settled; `mergeArm`, `merge()` and `mergeAt` read it in place of `settled.sha === tip` <!-- builds: settledPast and the unsettled-commits reading in packages/domain/src/rules --> → #3508

### The reading settles on completion

- `feature/the-reading-settles-on-completion` — the refresh asks a pending head again when its run's expected end passes; `Default branch checks` gains the job form `<workflow>/<job>`, and this repository declares `CI/validate` <!-- builds: an expected-end re-ask interval in default-branch-refresh.ts and a job form for Default branch checks --> → #3514

### A red main names its PR

- `feature/a-red-main-names-its-pr` — `writeRepairRecord` fills the candidates; `redMainPicker` names the oldest red candidate whose earlier candidates are green, holds on a pending one, and answers `unknown` otherwise; the revert reads the named candidate's runs a second time <!-- builds: oldest-red attribution in redMainPicker and repair-record candidates --> → #3521

### Merges stack two deep

- `feature/merges-stack-two-deep` <!-- waits: feature/a-red-main-names-its-pr --> <!-- deferred: runs only if merges per hour after slice 2 stay under 3 --> — `mergeArm`, `merge()` and `mergeAt` admit a PR onto a tip with at most 1 unsettled PR merge whose paths are disjoint from it, within 5 unsettled commits and with a clean `merge-tree`; new refusals `stack-full` and `paths-overlap` <!-- builds: stackVerdict with the refusals stack-full and paths-overlap -->

## Notes

### Measure

- **Throughput:** merges into main per hour, read from the host's `mergedAt`. Baseline about 1.5 per hour (2026-11-17, 08:56-14:10 UTC); target at least 3 per hour. Read again after slice 2 merges, over a working day with at least 6 PRs ready to merge; under 3 per hour lifts the `deferred:` marker on slice 4.
- **Latency:** median time from a PR that is green and reviewed to its merge.
- **Guard:** the share of red episodes where `redMainPicker` names one PR, the revert count, and the `exhausted` count. An `unknown` answer whose oldest non-green candidate is a qualifying-shape PR merge counts as a regression; an `unknown` whose oldest non-green candidate is a Plot-path commit or a direct push is the correct answer. After slice 4, each episode with two red PR merges in one stack is counted on its own.

### Sources

- Merge gates: `packages/domain/src/workflows/merge.ts:366-375` and `:537-564`; `packages/domain/src/rules/slice-pr-next.ts:368-418`.
- Re-ask interval and the settle walk: `packages/fleet/src/shared/default-branch-refresh.ts:29` and `:110-161`; `ANCESTOR_ASKS_MAX` at `packages/domain/src/rules/default-branch.ts:118`.
- Check names: `declaredRuns` at `rules/default-branch.ts:41`; `mergeChecksVerdict` at `rules/merge-checks.ts:43`; `packages/board/src/server/entry/merge-ports.ts:63`; `packages/fleet/src/shared/auto-merge.ts:369`.
- Path set: `packages/domain/src/rules/state-sync.ts:59-88`; `scripts/main-bundles.sh:65`; `.gitattributes` `-merge` lines.
- Refs reads: `firstParentCommits` (`ports/refs.ts:743`), `commitFiles` (`:452`), `headChanges` (`:329`), `conflictPaths` (`:343`).
- Attribution and revert: `packages/domain/src/rules/repair.ts:23`, `:126`, `:271-280`, `:307-314`; `packages/fleet/src/shared/default-branch-refresh.ts:202-218`; `packages/fleet/src/shared/revert-start.ts:122-126`, `:231`, `:302`, `:342-343`, `:385-386`; `packages/fleet/src/shared/revert-start-world.ts:138`; `packages/domain/src/adapters/revert/revert-git.ts:28`.
- CI: `.github/workflows/ci.yml:79` (concurrency), `:2013` (plan headings on push), `:2802-2809` (bundle freshness), `:2867` (`validate` needs).
- CI durations, commit counts and the `40881e43` example: GitHub Actions runs and `git log origin/main` for 2026-11-17, 08:56-14:10 UTC. Commits such as `dfaf01871` (`plot: record PR #3493`, one plan file), `92d114d2a` (`plot: book the brief`, a brief and a plan file) and `12c40e538` (`plot: build the board artifact`, 17 bundles) show the three kinds of commit that move the tip without a merge.
- Ruleset 24412719 on `plot-pm/plot`.
- Anti-goal: `docs/stories/archived/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:31,90`; plan `docs/plans/2026-10-29-fleetd-merges-slice-prs-one-at.md`.

### Defaults taken

- No `Story:` field: the story that held the merge loop, `the-fleet-delivers-a-scope-alone`, is archived, and no active story under `docs/stories/` owns merge throughput.
- Design question unanswered: the plan starts in `State: Draft`.
- Round 1 amended 2026-11-17: slice 3 moved ahead of the stack because attribution does not work today; slice 4 carries `deferred:` on the throughput measure, as the Approach already required.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "mode": "unattended",
  "questionHistory": [
    {"q": "Does redMainPicker still name one PR when PR2's run contains PR1's breakage?", "a": "No: both settle red, qualifying.length is 2, answer is unknown (repair.ts:136). Recorded as an open question.", "category": "technical"},
    {"q": "Do disjoint paths and a clean merge-tree keep the anti-goal of two PRs green on an old base and red together?", "a": "No: semantic interaction across files is not seen. Recorded as an open question.", "category": "tradeoffs"},
    {"q": "What does a revert of the lower stacked PR do when it conflicts with the upper one?", "a": "Not stated in the plan. Recorded as an open question.", "category": "domain"},
    {"q": "How do merge-in-flight and the commit-list reading change under a stack?", "a": "Not stated in the plan. Recorded as an open question.", "category": "technical"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": false,
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
