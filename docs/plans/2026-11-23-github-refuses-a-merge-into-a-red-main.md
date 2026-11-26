# GitHub refuses a merge into a red main

> fleetd writes main's settled reading as a `plot/main` commit status on the head of every open PR into the default branch, and the repository requires that status, so the GitHub merge button and a hand-run `gh pr merge` refuse while main is red.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** plot-describes-itself
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-23, jwloka, plan-PR #3691 merged
- **Started:** 2026-11-23, Jan Wloka, `feature/the-main-reading-becomes-a-pr-status`
- **Started:** 2026-11-26, Jan Wloka, `docs/the-repository-requires-plot-main`

## Changelog

- While main is red, every open pull request into main carries a failing `plot/main` status that names the red commit, so GitHub refuses the merge as Plot does. The repair PR the repair record names carries a passing `plot/main` status. When main settles green again, every `plot/main` status turns green.

<!-- Board impact: none. The slices add a domain rule, a fleetd pass and a rollout document. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

`default-branch-red` holds a merge only where Plot makes it. `plot-ask.mjs merge` and fleetd's merge arm both read `.plot/state/default-branch.json` and refuse while main is settled red (`mergeAt`, `packages/domain/src/workflows/merge.ts:394`). The GitHub merge button and a hand-run `gh pr merge` read nothing from Plot. The repository ruleset `main` (id `24412719`, active) requires a pull request and the status checks `validate` and `plot/review`, and it names no check that carries the default branch's reading. Its bypass list holds the admin role, the `Writer app` (`5656981`) and integration `5173644`, each with `always`.

On 2026-11-23 the operator merged #3685 at 10:52 UTC and #3682 at 10:54 UTC on GitHub. fleetd's reading read main settled red on `17a7fc438` the whole time. #3685 was the recorded repair PR, so Plot would also have admitted it. #3682 was not, and both Plot merge paths would have refused it with `default-branch-red`. The hold worked as written. GitHub never saw it.

## Design

### Approach

The reading becomes a status on each PR head, and GitHub enforces the status.

- **One rule decides the status.** A new domain rule, `mainHoldStatus(reading, repair, pr, now, checksWaitMs)`, returns `{ state, description }` for one open PR into the default branch. It answers `failure` where `defaultBranchRed` holds and the PR is not admitted by `repairMergeVerdict`. The description names the red commit (`main is red on 17a7fc438; merge the repair PR first`). It answers `success` for the admitted repair PR (`repair PR for 17a7fc438`) and for every PR while the reading is not red. The rule reuses `defaultBranchRed`, `holdsApply` and `repairMergeVerdict`, so the status and `mergeAt` read one decision. A PR into another base gets no status from this rule.
- **fleetd writes on change, not per tick.** A fleetd pass compares each open PR's wanted status with the last one it wrote for that head, and writes only the difference through the existing `Host.commitStatus` port (`ports/host.ts:531`), as the `Review app` identity `plot/review` already uses. A write is due where the settled state changes, the repair record names a new PR, or a PR gets a new head. The cost is one request per open PR per change. At 12 open PRs, a red episode costs about 24 writes: one to fail, one to clear.
- **The repository requires the status.** The existing ruleset `main` (`24412719`) adds `plot/main` to its required status checks, beside `validate` and `plot/review`. This is repository configuration, which only a person with admin rights sets. The rollout document names the setting, the context name and how to remove it.
- **A bypass actor still merges.** The admin role bypasses the ruleset `always`, so an administrator's merge on GitHub still lands while main is red; GitHub asks the administrator to confirm the bypass. This plan makes the hold visible on the merge button and binds every actor outside the bypass list. Removing the admin bypass is a repository decision this plan does not make.

### Open Questions

- [ ] `[question-fleetd-stops-while-red]` A commit status does not expire. If fleetd stops while main is red, every open PR keeps a failing `plot/main` until fleetd runs again, and GitHub refuses every merge. `defaultBranchRed` drops a reading older than `Checks wait`, but nothing rewrites the statuses once no fleetd runs. Options: (a) accept it: a person restarts fleetd or uses the ruleset's bypass; (b) `plot-fleet --stop` writes `success` on every PR before it unloads the supervisor, which lifts the hold on a main that is still red; (c) the status description names the reading's time, and a person reads it. Recommendation: (a) with (c). A hold that lifts when its writer stops is not a hold.
- [ ] `[question-bitbucket]` Bitbucket has the same gap. `commit-status` already writes a Bitbucket build status (`plot-bitbucket-commit-status.mjs`), and a Bitbucket merge check ("minimum successful builds") can require it. Options: (a) the same pass writes on both hosts, and the rollout document covers both settings; (b) Bitbucket is out of scope, and this plan says so. Recommendation: (a), because the writer and the rule are host-neutral and only the setting differs.
- [ ] `[question-new-pr-head]` A PR opened or pushed while main is red needs its status before a person can merge it. fleetd sees a new head only in its next PR delta, so for up to one PR pass the new head carries no `plot/main`. A required check that is absent also blocks a merge on GitHub, so the gap refuses rather than admits. Confirm that GitHub blocks on a missing required check under ruleset `24412719`, as it does for `plot/review` today.
- [ ] `[question-rate]` The writes spend the `Review app` installation's budget, not the signed-in user's. Confirm that the PR pass's cadence reads that spend, or that the volume (one write per PR per change) is small enough to leave out of it.

## Slices

### Status

- `feature/the-main-reading-becomes-a-pr-status` — `mainHoldStatus` decides `plot/main` for each open PR into the default branch, and a fleetd pass writes it through `Host.commitStatus` when the wanted status differs from the last one written for that head <!-- builds: mainHoldStatus, the plot/main status rule, and fleetd's plot/main write pass --> <!-- tests: mainHoldStatus — red with no admitted PR fails and names the red commit, the repair PR passes, green passes, a stale reading passes, a PR into a sprint base gets none; the pass writes once per change and nothing on an unchanged tick --> → #3695

### Rollout

- `docs/the-repository-requires-plot-main` <!-- waits: feature/the-main-reading-becomes-a-pr-status --> — the rollout document names how to add `plot/main` to the required checks of ruleset `main` (`24412719`) and remove it again, what its bypass list means for the hold, and what a failing `plot/main` asks of the reader <!-- builds: the plot/main section of docs/review-status-rollout.md -->

## Notes

Created from the session of 2026-11-23, after the operator merged #3682 on GitHub while main was red. Type, Review and Impl are the operator's answers. `Plan PRs: required`. A person sets the ruleset; no slice changes repository settings.
