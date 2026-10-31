# A red default branch is repaired or reverted

> When the default branch turns red, fleetd records the red episode and re-runs the failed jobs once. If main stays red, fleetd starts one main-repair agent that fixes forward through a PR, and reverts the PR merge that broke main if main is still red after `Main repair bound`.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2904
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2910 merged
- **Started:** 2026-10-29, Jan Wloka, `feature/the-repair-record`
- **Started:** 2026-10-30, Jan Wloka, `feature/merge-admits-the-repair-pr`
- **Started:** 2026-10-30, Jan Wloka, `feature/fleetd-starts-main-repair`
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- fleetd records each red episode of the default branch: the last green commit, the first red commit, the time fleetd first saw main settle red, and the PR merge that turned it red.
- fleetd re-runs the failed jobs of the first red commit once. A green re-run ends the episode, and no agent starts.
- fleetd starts one main-repair agent per red episode. The agent opens a fix PR, and that PR merges while main is red, after review and green CI.
- When main is still red after `Main repair bound` (seconds, default 3600), fleetd re-runs the last green commit, then opens a revert PR of the PR merge that turned main red and merges it on green. A red re-run of the last green commit, a red that no single PR merge explains, a conflicting revert, and a red revert PR each send a notification and revert nothing.
- fleetd closes the open fix PR and the open revert PR when main settles green by other means.
- Reverted work returns as a ticket on the plan it came from.

Board impact: a new `## Plot Config` key (`Main repair bound`) and a new state file (the repair record) under `.plot/state/`. `default-branch.json` keeps its schema at `v: 1`. The run log of #2899 shows the re-run, the repair and the revert as steps. Plan format and helper scripts are unchanged.

## Motivation

Nothing acts on a red default branch today. The red reading holds the dispatch of new slices (`packages/domain/src/rules/queue.ts:583`) and refuses every merge (`packages/domain/src/workflows/merge.ts:127-129`). Main stays red until a person acts. The story's anti-goal is exactly this: a run that delivers every plan but leaves the default branch red has failed. (`packages/fleet/src/server/entry/registryd-main.ts:2863` only scopes the hold for the log; it acts on nothing.)

**Most red episodes have no cause in the code.** Panel round 2 read 3365 settled `ci.yml` runs on main from 2026-09-29 to 2026-10-29: 306 red episodes, median 11 min, 38 longer than 60 min. 214 of 306 turned green across a diff that touched only `docs/`, `.plot/`, `*.md` or `.changeset/`. 16 re-runs of a red SHA turned green, and 1 stayed red. Without a re-run first, fleetd starts a main-repair agent about 300 times a month for nothing.

**The red SHA moves during an episode.** In 28 of the 38 episodes longer than 60 min, main carried more than one red SHA, up to 35. `build-bundles.yml` pushes `plot: build the board artifact` after a push that changes the bundles: 101 of 303 PR merges since 2026-10-20 are followed directly by that commit, and the next first-parent commit after a PR merge lands within a median of 28 s. `advanceSettled({sha:'R',state:'red'},'X','red')` returns `{sha:'X',state:'red'}`. So a rule pinned to one red SHA loses the episode within a minute; the rule pins the episode instead.

**The inputs to a repair are not recorded.** `default-branch-refresh.ts` records the settled reading and its `failingRuns` in `.plot/state/default-branch.json`, and nothing else a repair needs:

- The last green commit is lost: `advanceSettled` (`packages/domain/src/rules/default-branch.ts:110-115`) replaces a green settled reading with the red one. Panel round 1 executed `advanceSettled({sha:'G',state:'green'}, 'R', 'red')` and got `{sha:'R',state:'red'}`.
- The time main first settled red is not recorded: `headSince` is when fleetd first saw the head and resets on every new head, and `askedAt` moves on every answer.
- The PR index row holds no merge-commit SHA; only `packages/domain/src/entities/pr.ts:64` has `mergeCommit`. The host port answers it per branch: `Host.prMergeCommit` (`packages/domain/src/ports/host.ts:260`).

The refresh still holds the green SHA at the change from green to red (`packages/fleet/src/shared/default-branch-refresh.ts:210`, `carried = previous?.settled`), so the repair record is written there. Red starts in two arms: `advanceSettled` (`:232`) and the ancestor arm `settleBehindHead` (`:238`). The record write covers both. With no previous reading (`:193` reads `null` for a missing, other-branch or other-version file), the refresh sees no change from green to red. These fields do not go into `default-branch.json`: its schema is `.strict()` (`packages/domain/src/entities/default-branch.ts:73`), and `decodeDefaultBranch` (`:85`) turns a parse failure into `null`, which holds nothing. An added field or a version bump makes every older reader (the board, `plot-ask.mjs merge`) lift the hold on a red main.

**Neither repair PR can merge today.** All four round-1 jurors executed `merge()` with a green, ready revert PR on a fresh red reading and got `refused / default-branch-red`. #2902's merge arm in `slicePrNext` also holds every merge on red. Three tests pin that refusal: `packages/domain/test/workflows-merge.test.ts:128` and `:165`, and `packages/board/test/unit/merge-entry.test.ts:135`. This plan owns the narrow exception for the PR the repair record names.

**A fresh reading can be 30 min old.** `merge()` accepts a reading a host confirmed within `Checks wait` (`merge.ts:122-123`). Past `Checks wait`, the refresh re-asks a SHA only every `checksWaitMs / 2` (`reaskIntervalMs`, `default-branch-refresh.ts:40`), 1800 s at the default. A re-run that turns the same SHA green does not move the tip, so a merge on that reading can revert innocent work onto a main the host already reads green.

**Most commits on main are not PR merges.** Of 1273 first-parent commits on main since 2026-10-20, 169 read `Merge pull request` and 134 end in `(#N)`; the other 970 are direct pushes, mostly lifecycle records. 3 of the 134 `(#N)` commits are direct pushes by a person that name an issue. Reverting a lifecycle record runs a lifecycle step backwards, and `plot-state-gate.sh` refuses a `State:` change with no receipt. So fleetd reverts only a PR merge that the host reads `MERGED` and whose host merge commit is the candidate SHA.

**No port can re-run CI, close a PR or make a revert.** `packages/domain/src/ports/refs.ts` and `ports/host.ts` (`:193-427`) have none of the three; `ports/trees.ts` has `commit` (`:490`) and `push` (`:506`) only. `plot-host.sh` has `pr-create`, `pr-merge`, `pr-ready` and `pr-list` (`:4410-4482`) and no `pr-close` or run re-run.

**A reverted slice does not come back by a new heading.** `dispatchPhase` accepts only `approved` and `design` (`packages/domain/src/rules/auto-dispatch.ts:220`), so a new slice heading on a Delivered plan is never dispatched, and no controller appends a heading to a plan on main. The reverted work returns as a ticket instead.

Sibling plans this plan depends on: #2898 (the `main-repair` definition and the detached role start), #2902 (one merge in flight, the merge arm of `slicePrNext`), #2900 (`startReview`, the reviewer start every repair and revert PR goes through), #2899 (the run log), #2903 (the ticket writer).

## Design

### Approach

Binding source: [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), section *A red main*, as corrected by the decisions below. The decision is a domain rule over recorded state; a re-run, an agent start, a PR open, a PR close, a revert and a merge are adapter calls.

1. **The repair record and the episode.** `default-branch-refresh.ts` writes the record when settled turns red, in both arms (`advanceSettled` and `settleBehindHead`), while `previous.settled` still names the green commit. The record holds the last green SHA, the first red SHA, `redSince`, the candidate commits between them, the re-run state, the one repair attempt, the repair PR, and the revert PR. `redSince` is the time fleetd first observed the settled red, not a CI completion time, so a fleetd that was down at the change still gets the whole bound. With no previous reading, the refresh writes a record with no last green SHA and notifies: the picker answers `unknown`, no deterministic branch name exists, and the record goes to `exhausted`. The record's state is a lifecycle (`idle → rerun → repairing → reverting → done | exhausted`) with a `// plot-state: lifecycle` declaration and a rule under `packages/domain/src/transitions/`, so `scripts/check-state-declarations.sh` passes. It is a separate file from `default-branch.json` and from #2903's per-PR fixer attempts: a repair is per red episode, not per PR. fleetd writes the record before it re-runs, starts an agent or pushes a branch, so a crash or a second tick starts no second repair on one machine. An episode is open while no green has settled since the record was written and the settled SHA descends from the record's red SHA (a first-parent ancestry call under `# plot-ancestry: evidence`). A settled green closes the episode.
2. **The rule.** `redMainStep(readings, input)` reads the default-branch reading and the repair record and answers `none`, `hold`, `await-rerun`, `start-repair`, `await-repair`, `revert`, `close-prs` or `exhausted`. It spawns nothing and awaits nothing. `hold`, `await-rerun` and `start-repair` use `defaultBranchRed(reading, now, checksWaitMs)` (`rules/default-branch.ts:262`). `revert` uses the strict age that `merge()` uses (`defaultBranchAgeMs`, `:241`): a stale reading never reverts. `revert` also needs `headSha === settled.sha` (no newer head pending), an open episode, and `now - redSince >= Main repair bound`. A moved red SHA inside the same episode still answers `revert` or `await-repair`, never `close-prs`. `close-prs` answers a settled green only. A revert that merged with main still red answers `exhausted`, so one episode reverts once. `Main repair bound` takes seconds, like `Checks wait`, through a parser beside `checksWaitMsOf` (`:229`); its default is 3600.
3. **The re-runs.** On a newly settled red, fleetd re-runs the failed jobs of the first red SHA once, and `redMainStep` answers `await-rerun` until that re-run settles. A green re-run ends the episode with no agent. Before `revert`, fleetd re-runs the last green SHA. A red re-run there means a cause outside the repository (a flaky runner, an expired secret, an upstream dependency): fleetd notifies, reverts nothing, and the record goes to `exhausted`. A re-run costs one CI run (median 19.5 min, p90 29.5 min, measured in round 2).
4. **The breaking-commit picker.** A pure domain function over the first-parent commits after the record's last green SHA up to the record's first red SHA, their subjects and their runs. The window is fixed at those two SHAs and never reads the moving settled SHA, so the fix PR's own merge and the bundle bot's push never enter it. It answers a PR number only when exactly one candidate is a PR merge the host reads `MERGED`, the host's `mergeCommit` for that PR (`Host.prMergeCommit`) equals the candidate SHA, that candidate is settled red on its own runs, and it changes, adds or removes no `State:` line. It parses squash subjects (`Title (#N)`) as well as the two forms `mergedBySubject` reads (`rules/merge-subject.ts:88`). Every other case answers `unknown`, and `unknown` never reverts and notifies.
5. **The merge exception.** `merge()` and the merge arm of `slicePrNext` admit, on a red and fresh reading, only the PR the repair record names, pinned to its head, while the record's episode is open. The admitted PR's head branch must be the deterministic branch of step 6; a record that names any other branch admits nothing, so no caller can claim the exception by writing the record or naming itself. Immediately before the merge, fleetd re-asks the red SHA's runs on the host and merges only while they are still red; a reading up to `Checks wait` old is not enough. `default-branch-stale`, `head-moved`, `checks-not-green`, `checks-unbound` and `review-not-passed` still refuse it. Every other PR still refuses `default-branch-red`; the three tests above stay unchanged. On GitHub with no `Merger app` declared, the step answers `exhausted` and notifies once instead of waiting silently.
6. **One writer across machines.** The record is a local file under the common git dir (D6), so it guards one machine only. fleetd names each branch from facts every machine reads the same way: `bug/main-repair-<last-green-sha12>` for the fix and `bug/revert-<pr>` for the revert. Before it starts the agent or makes the revert commit, fleetd pushes the dispatch claim onto that new branch: an empty `plot: claim <branch>` commit (`packages/domain/src/workflows/agent-loop.ts:723-724`, judged by `claimTip` in `rules/claim.ts:40`). A second machine's push is not a fast-forward, so only one machine wins, and the loser starts nothing. `bug/` comes from the declared `Branch prefixes`: a red main is a defect.
7. **Fix forward.** On `start-repair`, fleetd starts the `main-repair` role in a worktree it creates on the claimed branch, with the failing run and the candidate commits. One repair attempt runs per episode. The role writes a fix PR or nothing. fleetd asks the host (`pr-list --branch`), not the index, before it opens a PR, treats `unaskable` as a hold, and opens it through `Host.prCreate` (`ports/host.ts:302`), never through `plot-host.sh` from fleetd code. This plan starts the review of the fix PR through #2900's `startReview`. A HIGH on the fix PR skips #2903's fixer and ends the attempt (C5); red CI on the fix PR ends it too. A merged fix that leaves main red starts no second attempt. The bound never pauses for a fix PR in review: at the bound fleetd opens the revert, and #2902's one merge in flight merges whichever PR passes first.
8. **Revert.** On `revert`, fleetd re-runs the last green SHA (step 3), re-asks the red SHA's runs, and confirms that the breaking commit is still on main and not already reverted. It asks the host (`pr-list --branch`) for an open revert PR, treats `unaskable` as a hold, claims `bug/revert-<pr>`, makes the revert through a new port operation, opens the revert PR, starts its review through `startReview`, and merges it through `merge()` with the exception in step 5. A conflicting revert, a red revert PR, a HIGH on the revert PR, and an `unknown` picker answer go to `exhausted`, which notifies once and starts nothing more. A merged revert notifies, naming the reverted PR and its plan.
9. **Close on green.** On `close-prs` (main settled green by other means), fleetd closes the open fix PR and the open revert PR the record names, through a new close-PR port operation, and the record goes to `done`.
10. **The reverted work.** The host still reads the reverted PR as merged, and that answer is never overridden. No lifecycle step runs backwards: a Delivered plan stays Delivered, and an Approved plan stays Approved. After the revert merges, fleetd writes a ticket naming the plan and the reverted PR through #2903's ticket writer (`feature/an-unfixed-high-is-ticketed`), keyed by the reverted PR. This plan writes no slice heading.

The new port operations are named deliverables, each on both drives (GitHub and Bitbucket) behind `plot-host.sh`, gated by `scripts/check-host-cli-callers.sh`: re-run the failed jobs of a SHA (slice 3 builds it, because the first re-run comes first), close a PR, and make a revert (slice 4 builds both).

Anti-goal check: the bound runs from the time fleetd first saw red settle, so a main that stays red, with a picker answer, is reverted within `Main repair bound` plus one re-run, one review and one merge round. A fleet unit test with a fake clock over several ticks, with the head moving every 12 min and a bundle-bot push after the breaking merge, proves this.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-a-red-default-branch-is-repaired/panel.md`):

- [x] D1: fleetd merges the fix PR and the revert PR in process through `merge()` with its typed `caller` reading, which #2898's `feature/unattended-callers-are-refused` builds. An unattended caller outside fleetd stays refused.
- [x] D3: a fix PR and a revert PR are not scope items. The scope stays the active sprint file; the repair record, not the scope reader, names the PR the reviewer and the merge exception admit.
- [x] D4: on GitHub, fleetd merges a repair PR only when `Merger app` is declared, so the merge runs as the App bot under the ruleset and never through the admin bypass. An undeclared `Merger app` answers `exhausted` and notifies.
- [x] D5: `main-repair` is `.claude/agents/main-repair.md` plus a per-role settings file, both built by #2898's `feature/role-agent-definitions`. This plan adds nothing under `.claude/agents/`. fleetd creates the repair worktree itself. The role's settings deny a push to the default branch, so "never pushes to main" is a gate.
- [x] The merge exception belongs to this plan, in its own slice, narrow and keyed on the repair record.
- [x] The rule's inputs live in a separate repair record; `default-branch.json` stays at `v: 1` with no new field.
- [x] fleetd reverts only a PR merge the host reads `MERGED` and whose host `mergeCommit` equals the candidate SHA. A direct push, a `State:` line changed, added or removed, and an ambiguous window answer `unknown` and notify.
- [x] A conflicting revert notifies (`exhausted`); the main-repair agent never resolves a revert.
- [x] A stale reading never reverts: `revert` uses `merge()`'s strict age, not `defaultBranchRed`.
- [x] Dependencies are `waits:` annotations on the slices, exactly as the story's slice map gives them; an issue link holds no dispatch.

Decided 2026-10-29 by Jan Wloka after panel round 2 and the challenges (`.plot/panels/2026-10-29-a-red-default-branch-is-repaired/r2-safety.md`, `r2-resolver.md`, and `loop-decisions.md` C5):

- [x] C5: a HIGH on a repair PR skips the fixer and goes to the revert at the bound. This is an exception to D2.
- [x] C5: reverted work returns as a ticket for a Delivered and an Approved plan alike, through #2903's ticket writer.
- [x] C5: a red is re-run once before main-repair, and the last green commit is re-run before a revert. Red there too means a cause outside the repository, so fleetd notifies and reverts nothing.
- [x] C5: `Main repair bound` defaults to 60 minutes (3600 s). Measured: 214 of 306 red episodes in 31 days turned green with no code change.
- [x] The merge exception and the revert pin the red episode, not one SHA: no green has settled since the record was written, and settled descends from the record's red SHA. The picker's window is fixed at the last green and the first red SHA, never the moving settled SHA.
- [x] fleetd re-asks the red SHA's runs on the host immediately before it merges a repair PR or makes a revert.
- [x] One writer across machines is the dispatch claim push onto a deterministic branch per episode: `bug/main-repair-<last-green-sha12>` and `bug/revert-<pr>`. The exception admits only those branches.
- [x] fleetd closes the open fix PR and the open revert PR when main settles green by other means.
- [x] The record is written in both refresh arms. With no previous reading, fleetd writes a record with no last green SHA and notifies.
- [x] One repair attempt per episode. A merged fix that leaves main red starts no second attempt, and the bound never pauses for a fix PR in review.
- [x] A revert that merged with main still red, a red revert PR and a HIGH on the revert PR go to `exhausted`. One episode reverts once.
- [x] `redSince` is the time fleetd first observed the settled red. When fleetd was down past the bound with a record already written, it reverts on the first fresh reading after the re-runs.
- [x] The re-run, close-PR and revert port operations are named deliverables of this plan, on both drives.
- [x] Repair and revert reviews go through #2900's `startReview`, started by this plan's slices 3 and 4.
- [x] fleetd opens a PR through `Host.prCreate`, after a `pr-list --branch` read on the host; `unaskable` holds.

### Open Questions

- [ ] Does `plot-reconcile-scan.sh` or the fleet scan report the plan-less `bug/main-repair-*` and `bug/revert-*` branches as unplanned members or as stale? Not verified in round 2. If it does, the result is noise and not harm; slice 3 measures it.

## Slices

### Repair record

- `feature/the-repair-record` — written at the green→red change: last green SHA, first-red time, the candidate merge; a `transitions/` rule <!-- builds: the repair record in both refresh arms, its lifecycle and transitions rule, redMainStep with the episode pin, the breaking-commit picker, and the Main repair bound parser --> → #2936

### Merge exception

- `feature/merge-admits-the-repair-pr` — the narrow exception in `merge()` and `slicePrNext` for the PR the repair record names <!-- waits: feature/fleetd-merges-one-at-a-time --> → #2966

### Main repair start

- `feature/fleetd-starts-main-repair` — re-run the red commit's failed jobs once first; then main-repair start and its fix PR, reviewed through #2900's `startReview` <!-- waits: feature/role-agents-start-detached --> <!-- waits: feature/fleetd-reviews-slice-prs --> <!-- builds: the re-run port operation on both drives, and the claim push onto bug/main-repair-<last-green-sha12> -->

### Breaking merge revert

- `feature/a-red-main-is-reverted` — revert, re-run, close-PR operations on a port; re-run the last green commit before a revert; reverts only a merge the host reads MERGED; `unknown` notifies; a ticket through #2903's writer <!-- waits: feature/fleetd-reviews-slice-prs --> <!-- waits: feature/an-unfixed-high-is-ticketed --> <!-- builds: the revert and close-PR port operations on both drives, and the claim push onto bug/revert-<pr> -->

## Notes

- Created from tracker issue #2904 by an unattended `/plot-idea` run on 2026-10-29. Amended after panel round 1 and after panel round 2 on 2026-10-29.
- Ceremony answers (`Review: pr`, `Impl: own branches`) follow `Plan PRs: required` and a multi-slice plan.
- Owned elsewhere: `main-repair.md` and the per-role settings belong to #2898 (`feature/role-agent-definitions`); `startReview` belongs to #2900 (`feature/fleetd-reviews-slice-prs`); the run log and its step words belong to #2899 (`feature/the-loop-keeps-a-run-log`); the ticket writer belongs to #2903 (`feature/an-unfixed-high-is-ticketed`).
- Tests for `feature/the-repair-record`: a domain table test of `redMainStep` (stale red never reverts; a pending head blocks the revert; a moved red SHA in the same episode still answers `revert`; a settled green answers `close-prs`; a pending re-run answers `await-rerun`; a green re-run answers `none`; red with no record; a merged revert with main still red answers `exhausted`); a fleet unit test of the refresh writing the record in both arms and with no previous reading; a picker table test (one PR merge, none, a direct push, `(#N)` with `mergeCommit` not equal to the SHA, two PR merges, a squash subject, a plan file added or removed); a parser test for `Main repair bound`.
- Tests for `feature/merge-admits-the-repair-pr`: the three existing `default-branch-red` tests stay unchanged; `merge()` admits the repair PR after a bundle commit settled red on top of the red SHA; `merge()` refuses a record that names a non-deterministic branch; `merge()` refuses when the re-asked red SHA reads green; a mutation check removes the episode pin and the branch-name check, and a test fails for each.
- Tests for `feature/fleetd-starts-main-repair`: a fleet unit test that a crash after the record write starts no second agent; a lost claim push starts nothing; an adapter test of the re-run operation on both drives.
- Tests for `feature/a-red-main-is-reverted`: an adapter test on a temp git repo for the revert of a squash landing and of a merge-commit landing and for a conflict; the close-PR operation on both drives; the multi-tick fake-clock anti-goal test with the head moving every 12 min and a bundle-bot push after the breaking merge.
