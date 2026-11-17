# Main merges more than one PR per CI run

> fleetd and `plot-ask.mjs merge` merge into main at least 3 PRs per hour, and `redMainPicker` still names the one PR that turned main red.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Changelog

- A commit on the default branch that changes only Plot's bookkeeping paths or the generated bundles no longer restarts the wait for a settled main. fleetd and `plot-ask.mjs merge` treat it as settled with the commit before it.
- The default-branch reading asks a pending head again when its CI run is expected to end, not on a fixed 5-minute interval, and it folds only the jobs `Default branch checks` names.
- fleetd and `plot-ask.mjs merge` merge a PR onto a default branch that carries at most 2 unsettled PR merges, when the PR's changed paths are disjoint from theirs and the combined `merge-tree` is clean. New refusals: `stack-full` and `paths-overlap`.
- When a stacked red episode leaves `redMainPicker` with the answer `unknown`, Plot notifies a person.

<!-- Board impact: the board shows merge refusals by name; `stack-full` and `paths-overlap` are two new names it must render. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

Measured on 2026-11-17 from host data: main takes about 1.5 merges per hour. A merge waits until main's CI settles green on the exact tip, and main's tip moves far more often than PRs merge.

**The hold.** `merge()` in `packages/domain/src/workflows/merge.ts:366-375` refuses `default-branch-unsettled` unless main's fresh tip equals both the reading's `headSha` and `settled.sha`. `mergeAt` (`:537-564`) makes the same check before it asks `prReview`. fleetd's `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts:368-418`) holds `default-branch-unsettled` while `settled` is not green (`:405`), and holds `merge-in-flight` while `settled.sha !== headSha` or a MERGED row is newer than `askedAt` (`:408-410`). `nextMerge` allows one merge per pass.

**The wait per settle.** Main's CI takes about 21 min: `gates` 1.2, `checks` 7.5, `census-*` 12.2. `census` is not a required check, but the reading folds the whole `CI` workflow run, which ends about 5 min after `validate`. The reading writer `packages/fleet/src/shared/default-branch-refresh.ts` asks a pending head again every `REASK_MS` = 5 min (`:29`), so a settle is seen up to 5 min after it happens.

**The tip moves without a merge.** Each merge moves the tip twice: `build-bundles.yml` pushes `plot: build the board artifact` about 40 s later. Direct bookkeeping pushes (`plot: record PR #N`, `plot: book the brief and plan start for …`) also restart the wait. Between 08:56 and 14:10 UTC there were about 15 such commits against 8 merges. Example: `40881e43`, pushed at 13:27, held the next merge until 14:09.

**What already holds attribution.** Every commit on main gets its own CI run: the push concurrency group is `run_id`, so a run is never cancelled by the next push. `redMainPicker` (`packages/domain/src/rules/repair.ts:126`) names a PR only when exactly one commit in last-green..first-red is a PR merge that settled red on its own runs. Per-commit runs mean a stack of merges still gives each merge its own verdict.

**Why the hold exists.** The anti-goal in `docs/stories/archived/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:31,90` reads "Main goes red and stays red… two PRs green on an old base can be red together". Plan `2026-10-29-fleetd-merges-slice-prs-one-at.md` introduced the hold (commits `28df9fd66`, `68238382a`). This plan keeps that anti-goal: a stacked PR must not share changed paths with the unsettled merges below it, and the combined tree must merge clean.

**The ruleset.** Ruleset 24412719 on `main` requires `validate` and `plot/review`, with strict status checks off, and it has no merge-queue rule.

## Design

### Approach

The plan raises throughput in two steps. First it makes a settle cheaper and faster without any new risk. Then it admits a bounded stack of unsettled merges.

**Step 1: a commit that changes no code does not need its own settle.** A new domain rule reads the commits between `settled.sha` and the tip. When each of them changes only paths in the Plot path set below, the rule answers that the tip is settled with `settled`. `mergeArm` and `merge()` (and `mergeAt`'s pre-review check) read the rule's answer in place of the bare `tip === settled.sha` comparison.

The path set is the union of two existing sets, taken from the code, never from a commit's subject or author:

- `syncPathSet` in `packages/domain/src/rules/state-sync.ts:59`: the `Plan directory`, `Active index`, `Delivered index` and `Sprint directory` values, the release records directory (`docs/releases/` by default), `.plot/briefs/` (`BRIEFS_DIR`) and `.plot/hold` (`HOLD_FILE`). This is the set a sync PR may change, and it holds every path the bookkeeping commits write: `plot: record PR #N` changes one plan file, and `plot: book the brief …` changes `.plot/briefs/<slug>.md` and one plan file.
- The generated bundle set: `build.mjs`'s `shipped*` declarations, the same list `scripts/main-bundles.sh:65` reads with `read_shipped_bundles` and `.gitattributes` marks `-merge` under `skills/plot/scripts/board/`. `build-bundles.yml` commits only these paths.

A path with `..` segments, a rename out of the set, or an unread diff answers "not settled", so the rule fails closed the way `syncPathVerdict` does. The commit still gets its own CI run. If that run settles red, the reading turns red and `default-branch-red` holds as it does today.

**Step 2: the reading sees a settle when it happens.** The refresh asks a pending head again when its run's expected end passes, computed from the run's start time and the duration of the last green runs of the same jobs, in place of the fixed `REASK_MS`. `REASK_MS` stays as the upper bound. `Default branch checks` names the required jobs (`validate`), not the whole `CI` workflow, so the reading settles when `validate` ends and does not wait for `census-*`.

**Step 3: a bounded stack.** `merge()` and `mergeArm` admit a PR onto a tip that carries at most 2 unsettled PR merges (after step 1 has removed the Plot-path commits from the count), when:

- the PR's changed paths are disjoint from the changed paths of every unsettled merge, and
- `git merge-tree` of the tip with the PR's head is clean.

A third unsettled merge refuses `stack-full`. A shared path refuses `paths-overlap`, naming the paths and the unsettled PR. `settled` must still be green; a red, stale or unread reading holds as today. The depth of 2 is a constant in the domain; this plan does not make it a config key.

**Step 4: attribution of a stacked red.** Each stacked merge keeps its own CI run, so `redMainPicker` can name the one PR that settled red on its own runs. New tests cover a red episode with 2 and 3 stacked merges, where one or more settle red. Where `redMainPicker` answers `unknown` for a stacked episode, Plot notifies a person, and the measure below counts it as a regression.

### Approaches considered

- **GitHub merge queue.** Rejected. GitHub merges in place of the Merger app, so a merge bypasses `mergeAt` and its `--match-head` pinning. `plot/review` must be posted on the merge-group SHAs. The bookkeeping and bundle pushes need a bypass. Bitbucket has no equivalent, and the Layering Rule keeps the merge decision host-agnostic.
- **Train branch.** CI runs on main + PR1 + PR2, and main then fast-forwards to it. Rejected. The `pull_request` rule of the ruleset blocks the fast-forward push, and `redMainPicker` needs host merge commits to name a PR. It rebuilds a merge queue inside Plot.
- **Chosen.** A cheaper settle first (slices 1 and 2), then a bounded stack (slices 3 and 4). Slices 1 and 2 add no risk and may reach the target alone; slice 3 runs only if the measure after slice 2 stays under 3 merges per hour.

### Open Questions

- [ ] **Stacked red attribution can answer `unknown` by construction.** `redMainPicker` (`repair.ts:135-137`) answers a PR only when exactly one candidate is settled red on its own runs. PR2 merges on top of PR1, so PR2's run contains PR1's change: when PR1 breaks main, both commits settle red, two candidates qualify, and the answer is `unknown`. Step 4 states that each merge keeps its own verdict; for a stack that holds only when PR2 is independent of the breakage. Slice 4 must either change the picker (name the lowest red candidate whose parent commit settled green) or accept `unknown` plus a notification for every stacked red, and the Guard measure then counts every stacked red as a regression.
- [ ] **Disjoint paths plus a clean `merge-tree` do not keep the anti-goal.** `DESIGN-delivery-loop.md:31,90` names two PRs green on an old base that are red together. Two PRs can touch different files and still break each other (a signature change in one file, a new caller in another), and neither `paths-overlap` nor `merge-tree` sees that. The Design says the plan keeps the anti-goal; it narrows it to textual overlap. Decide whether the stack rule adds a semantic bound (for example, no stacking when either PR changes `packages/domain/src/ports/` or a shared type), or states the narrowed anti-goal and relies on step 4 and the revert path.
- [ ] **Reverting the lower PR of a stack.** If PR1 settles red with PR2 already merged on it, `bug/revert-<revertedPr>` reverts PR1 over PR2's changes and can conflict. State what `redMainStep` does when the revert does not apply cleanly, and whether it reverts the stack top-down.
- [ ] **`merge-in-flight` under a stack.** `mergeArm` holds `merge-in-flight` while `settled.sha !== headSha` or a MERGED row is newer than `askedAt` (`slice-pr-next.ts:407-410`). Both conditions are true for every PR merged onto an unsettled tip, so step 3 must name how they change, and which reading supplies the commit list and per-commit changed paths that `mergeArm` needs (a new port reading, since `mergeArm` is pure over readings).
- [ ] **Counting unsettled merges.** Step 3 counts PR merges between `settled.sha` and the tip after step 1 removes Plot-path commits. State whether a plan-only PR merge (a merge commit whose paths all lie in the set) counts, and how a stack is counted when `settled.sha` is itself older than a settled-red tip.
- [ ] Does CI on main test the generated bundles in a way the merge commit's run did not? A bundle commit is a deterministic rebuild (`main-bundles.sh` refuses a non-deterministic one), but a contract suite that runs the shipped bundle could still go red on it alone.
- [ ] A plan-file commit can turn main red through a docs gate (`check-plan-headings.sh`). Step 1 treats it as settled for the merge gate only; its own run still feeds the reading. Is that enough, or does the rule exclude paths a `scripts/check-*.sh` gate reads?
- [ ] The config shape for job names in `Default branch checks`: today it names workflows (`default-branch-refresh.ts:88`). The repo already declares `Merge checks: validate`, which `merge-ports.ts:63` and `auto-merge.ts:369` read for a PR's checks. Slice 2 decides whether the reading reuses `Merge checks` or `Default branch checks` gains a job form such as `CI/validate`.
- [ ] Is a stack depth of 2 right, or does slice 3 measure 1 first?

## Slices

### The settle ignores Plot commits

- `feature/the-settle-ignores-plot-commits` — a domain rule treats commits past `settled` as settled when they change only `syncPathSet` paths or generated bundles; `mergeArm`, `merge()` and `mergeAt` read it <!-- builds: a settled-past-Plot-commits rule in packages/domain/src/rules -->

### The reading settles on completion

- `feature/the-reading-settles-on-completion` — the refresh asks a pending head again when its run's expected end passes, and `Default branch checks` names only the required jobs, not `census` <!-- builds: an expected-end re-ask interval in default-branch-refresh.ts -->

### Merges stack two deep

- `feature/merges-stack-two-deep` — `merge()` and `mergeArm` admit a PR onto a tip with at most 2 unsettled PR merges whose changed paths are disjoint from it and whose combined `merge-tree` is clean; new refusals `stack-full` and `paths-overlap` <!-- builds: a stack admission rule with the refusals stack-full and paths-overlap -->

### A stacked red names its PR

- `feature/a-stacked-red-names-its-pr` — `redMainPicker` tests for stacked red episodes, and a notification when it answers `unknown` <!-- builds: stacked-episode tests for redMainPicker and an unknown-attribution notification -->

## Notes

### Measure

- **Throughput:** merges into main per hour, read from the host's `mergedAt`. Baseline about 1.5 per hour (2026-11-17, 08:56-14:10 UTC); target at least 3 per hour.
- **Latency:** median time from a PR that is green and reviewed to its merge.
- **Guard:** the share of red episodes where `redMainPicker` names one PR, and the revert count. A stacked red that reads `unknown` counts as a regression.

### Sources

- Merge gates: `packages/domain/src/workflows/merge.ts:366-375` and `:537-564`; `packages/domain/src/rules/slice-pr-next.ts:368-418`.
- Re-ask interval: `packages/fleet/src/shared/default-branch-refresh.ts:29`.
- Path set: `packages/domain/src/rules/state-sync.ts:49-61`; `scripts/main-bundles.sh:65`; `.gitattributes` `-merge` lines.
- Attribution: `packages/domain/src/rules/repair.ts:126`.
- CI durations, commit counts and the `40881e43` example: GitHub Actions runs and `git log origin/main` for 2026-11-17, 08:56-14:10 UTC. Commits such as `dfaf01871` (`plot: record PR #3493`, one plan file), `92d114d2a` (`plot: book the brief`, a brief and a plan file) and `12c40e538` (`plot: build the board artifact`, 17 bundles) show the three kinds of commit that move the tip without a merge.
- Ruleset 24412719 on `plot-pm/plot`.
- Anti-goal: `docs/stories/archived/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:31,90`; plan `docs/plans/2026-10-29-fleetd-merges-slice-prs-one-at.md`.

### Defaults taken

- No `Story:` field: the story that held the merge loop, `the-fleet-delivers-a-scope-alone`, is archived, and no active story under `docs/stories/` owns merge throughput.
- Design question unanswered: the plan starts in `State: Draft`.

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
