# A red default branch is repaired or reverted

> When the default branch turns red, fleetd records the red episode, starts a main-repair agent that fixes forward through a PR, and reverts the PR merge that broke main if main is still red after `Main repair bound`.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2904
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- fleetd records when the default branch turns red, the last green commit, and the PR merge that turned it red.
- fleetd starts a main-repair agent on a red default branch. The agent opens a fix PR, and that PR merges while main is red, after review and green CI.
- When main is still red after `Main repair bound` (seconds), fleetd opens a revert PR of the PR merge that turned main red and merges it on green. A red that no single PR merge explains, a conflicting revert, and a red revert PR each send a notification and revert nothing.
- fleetd closes an open revert PR when main turns green by other means.

Board impact: a new `## Plot Config` key (`Main repair bound`) and a new state file (the repair record) under `.plot/state/`. `default-branch.json` keeps its schema at `v: 1`. The run log of #2899 shows the repair and the revert as steps. Plan format and helper scripts are unchanged.

## Motivation

Nothing acts on a red default branch today. The red reading holds the dispatch of new slices (`packages/domain/src/rules/queue.ts:583`) and refuses every merge (`packages/domain/src/workflows/merge.ts:127-129`). Main stays red until a person acts. The story's anti-goal is exactly this: a run that delivers every plan but leaves the default branch red has failed. (`packages/fleet/src/server/entry/registryd-main.ts:2863` only scopes the hold for the log; it acts on nothing.)

**The inputs to a repair are not recorded.** `default-branch-refresh.ts` records the settled reading and its `failingRuns` in `.plot/state/default-branch.json`, and nothing else a repair needs:

- The last green commit is lost: `advanceSettled` (`packages/domain/src/rules/default-branch.ts:110-115`) replaces a green settled reading with the red one. Panel round 1 executed `advanceSettled({sha:'G',state:'green'}, 'R', 'red')` and got `{sha:'R',state:'red'}`.
- The time main first settled red is not recorded: `headSince` is when fleetd first saw the head and resets on every new head, and `askedAt` moves on every answer.
- The PR index row holds no merge-commit SHA; only `packages/domain/src/entities/pr.ts:64` has `mergeCommit`.

The refresh still holds the green SHA at the change from green to red (`packages/fleet/src/shared/default-branch-refresh.ts:210`, `carried = previous?.settled`), so the repair record is written there. These fields do not go into `default-branch.json`: its schema is `.strict()` (`packages/domain/src/entities/default-branch.ts:73`), and `decodeDefaultBranch` (`:85`) turns a parse failure into `null`, which holds nothing. An added field or a version bump makes every older reader (the board, `plot-ask.mjs merge`) lift the hold on a red main.

**Neither repair PR can merge today.** All four jurors executed `merge()` with a green, ready revert PR on a fresh red reading and got `refused / default-branch-red`. #2902's merge arm in `slicePrNext` also holds every merge on red. Three tests pin that refusal: `packages/domain/test/workflows-merge.test.ts:128` and `:165`, and `packages/board/test/unit/merge-entry.test.ts:135`. This plan owns the narrow exception for the PR the repair record names.

**Most commits on main are not PR merges.** Of 1273 first-parent commits on main since 2026-10-20, 169 read `Merge pull request` and 134 end in `(#N)`; the other 970 are direct pushes, mostly lifecycle records. Reverting a lifecycle record runs a lifecycle step backwards, and `plot-state-gate.sh` refuses a `State:` change with no receipt. So fleetd reverts only a PR merge that the host reads `MERGED`.

**No port can make a revert.** `packages/domain/src/ports/refs.ts` and `ports/host.ts` have no revert operation; `ports/trees.ts` has `commit` (`:490`) and `push` (`:506`) only.

**A reverted slice does not come back by a new heading.** `dispatchPhase` accepts only `approved` and `design` (`packages/domain/src/rules/auto-dispatch.ts:220`), so a new slice heading on a Delivered plan is never dispatched, and no controller appends a heading to a plan on main.

Sibling plans this plan depends on: #2898 (the `main-repair` definition and the detached role start), #2902 (one merge in flight, the merge arm of `slicePrNext`), #2900 (the reviewer that writes `plot/review` on repair PRs), #2899 (the run log), #2903 (the ticket writer).

## Design

### Approach

Binding source: [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), section *A red main*, as corrected by the decisions below. The decision is a domain rule over recorded state; an agent start, a PR open, a revert and a merge are adapter calls.

1. **The repair record.** `default-branch-refresh.ts` writes the record at the change from green to red, while `previous.settled` still names the green commit. The record holds the last green SHA, the red SHA, the time red first settled, the candidate commits between them, the attempt, the repair PR, and the revert PR. Its state is a lifecycle (`idle → repairing → reverting → done | exhausted`) with a `// plot-state: lifecycle` declaration and a rule under `packages/domain/src/transitions/`, so `scripts/check-state-declarations.sh` passes. It is a separate file from `default-branch.json` and from #2903's per-PR fixer attempts: a repair is per red episode, not per PR. fleetd writes the record before it starts an agent or pushes a branch, so a crash or a second tick starts no second repair.
2. **The rule.** `redMainStep(readings, input)` reads the default-branch reading and the repair record and answers `none`, `hold`, `start-repair`, `await-repair`, `revert`, `close-revert` or `exhausted`. It spawns nothing and awaits nothing. `hold` and `start-repair` use `defaultBranchRed(reading, now, checksWaitMs)` (`rules/default-branch.ts:262`). `revert` uses the strict age that `merge()` uses (`defaultBranchAgeMs`, `:241`): a stale reading never reverts. `revert` also needs `headSha === settled.sha` (no newer head pending) and `now - redSince >= Main repair bound`. `Main repair bound` takes seconds, like `Checks wait`, through a parser beside `checksWaitMsOf` (`:229`).
3. **The breaking-commit picker.** A pure domain function over the first-parent commits after the last green SHA up to the red SHA, their subjects and their runs. It answers a PR number only when exactly one candidate is a PR merge the host reads `MERGED`, that candidate is settled red on its own runs, and it changes no `State:` line. It parses squash subjects (`Title (#N)`) as well as the two forms `mergedBySubject` reads (`rules/merge-subject.ts:88`). Every other case answers `unknown`, and `unknown` never reverts. Ancestry calls here carry `# plot-ancestry: evidence`.
4. **The merge exception.** `merge()` and the merge arm of `slicePrNext` admit, on a red and fresh reading, only the PR the repair record names, pinned to its head, and only while the settled red SHA equals the record's red SHA. `default-branch-stale`, `head-moved`, `checks-not-green`, `checks-unbound` and `review-not-passed` still refuse it. Every other PR still refuses `default-branch-red`; the three tests above stay unchanged. No caller can claim the exception by naming itself.
5. **Fix forward.** On `start-repair`, fleetd starts the `main-repair` role in a worktree it creates on the default branch, with the failing run and the candidate commits. The role writes a fix PR or nothing. The PR opens through `plot-host.sh pr-create` (no controller opens a repair PR yet); fleetd asks the host (`pr-list --branch`), not the index, before it opens one. #2900's reviewer runs on the fix PR because the repair record names it.
6. **Revert.** On `revert`, fleetd confirms with a fresh reading that main is still red on the same red SHA and that the breaking commit is still on main and not already reverted. It then makes the revert through a new port operation, opens the revert PR, and merges it through `merge()` with the exception in step 4. On `close-revert` (main turned green, or the settled SHA moved), fleetd closes the revert PR. A conflicting revert, a red revert PR, and an `unknown` picker answer go to `exhausted`, which notifies once and starts nothing more.
7. **The reverted work.** The host still reads the reverted PR as merged, and that answer is never overridden. A Delivered plan stays Delivered; no lifecycle step runs backwards. This plan writes no slice heading and no ticket; see Open Questions.

Anti-goal check: the bound runs from the time red first settled, so a main that stays red, with a picker answer, is reverted within `Main repair bound` plus one review and merge round. A fleet unit test with a fake clock over several ticks proves this.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-a-red-default-branch-is-repaired/panel.md`):

- [x] D1: fleetd merges the fix PR and the revert PR in process through `merge()` with its typed `caller` reading, which #2898's `feature/unattended-callers-are-refused` builds. An unattended caller outside fleetd stays refused.
- [x] D3: a fix PR and a revert PR are not scope items. The scope stays the active sprint file; the repair record, not the scope reader, names the PR the reviewer and the merge exception admit.
- [x] D4: on GitHub, fleetd merges a repair PR only when `Merger app` is declared, so the merge runs as the App bot under the ruleset and never through the admin bypass.
- [x] D5: `main-repair` is `.claude/agents/main-repair.md` plus a per-role settings file, both built by #2898's `feature/role-agent-definitions`. This plan adds nothing under `.claude/agents/`. fleetd creates the repair worktree itself. The role's settings deny a push to the default branch, so "never pushes to main" is a gate.
- [x] The merge exception belongs to this plan, in its own slice, narrow and keyed on the repair record.
- [x] The rule's inputs live in a separate repair record; `default-branch.json` stays at `v: 1` with no new field.
- [x] fleetd reverts only a PR merge the host reads `MERGED`. A direct push, a `State:` write and an ambiguous window answer `unknown` and notify.
- [x] A conflicting revert notifies (`exhausted`); the main-repair agent never resolves a revert.
- [x] A stale reading never reverts: `revert` uses `merge()`'s strict age, not `defaultBranchRed`.
- [x] Dependencies are `waits:` annotations on the slices, exactly as the story's slice map gives them; an issue link holds no dispatch.

### Open Questions

- [ ] A red from outside the repository (a flaky runner, an expired secret, an upstream dependency) has nothing to fix and nothing to revert. Does fleetd re-run CI on the last green SHA before a revert, and answer `unknown` when that run is red too?
- [ ] How many main-repair attempts run inside the bound, and does a merged fix that leaves main red start a second attempt?
- [ ] When fleetd was down for longer than the bound, does it revert at once on restart, or start a repair first?
- [ ] Which one-writer gate guards a repair across machines: a deterministic revert branch name, or a ref claim as dispatch uses? The branch prefix for repair PRs is open too: `Branch prefixes` lists `idea/ feature/ bug/ docs/ infra/`.
- [ ] Does a HIGH review finding on a repair PR go to #2903's fixer (D2), and does a red repair PR take a fixer attempt?
- [ ] Does the bound pause while a fix PR is green and in review, or does a revert race it?
- [ ] The return path for reverted work. For a Delivered plan, a ticket naming the plan through #2903's ticket writer (`feature/an-unfixed-high-is-ticketed`); no slice of this plan calls it yet. For an Approved plan, a new slice heading needs a controller that writes it.

## Slices

### Repair record

- `feature/the-repair-record` — the record written at the change from green to red: last green SHA, red SHA, first-red time, candidate commits; written before any action; a `transitions/` rule <!-- builds: the repair record, its lifecycle and transitions rule, redMainStep, and the Main repair bound parser -->

### Merge exception

- `feature/merge-admits-the-repair-pr` — the narrow exception in `merge()` and `slicePrNext` for the PR the repair record names, pinned to the red SHA <!-- waits: feature/fleetd-merges-one-at-a-time -->

### Main repair start

- `feature/fleetd-starts-main-repair` — fleetd starts main-repair and opens its fix PR, reviewed by #2900's reviewer <!-- waits: feature/role-agents-start-detached -->

### Breaking merge revert

- `feature/a-red-main-is-reverted` — a revert operation on a port; reverts only a PR merge the host reads MERGED; `unknown` notifies; closes the revert PR if main turns green <!-- builds: the breaking-commit picker and the revert port operation -->

## Notes

- Created from tracker issue #2904 by an unattended `/plot-idea` run on 2026-10-29. Amended after panel round 1 on 2026-10-29.
- Ceremony answers (`Review: pr`, `Impl: own branches`) follow `Plan PRs: required` and a multi-slice plan.
- Owned elsewhere: `main-repair.md` and the per-role settings belong to #2898 (`feature/role-agent-definitions`); the reviewer start belongs to #2900 (`feature/fleetd-reviews-slice-prs`); the run log and its step words belong to #2899 (`feature/the-loop-keeps-a-run-log`); the ticket writer belongs to #2903 (`feature/an-unfixed-high-is-ticketed`).
- Tests per slice: a domain table test of `redMainStep` over readings and record (stale red never reverts, pending head blocks revert, green closes the revert); domain tests of the merge exception with a mutation check on the red-SHA pin; a fleet unit test that a crash after the record write starts no second agent; an adapter test on a temp git repo for squash and merge-commit landings and a conflict; the multi-tick fake-clock test for the anti-goal.
