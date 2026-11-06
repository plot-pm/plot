# Safety juror: the-release-head-reports-validate-with

Position: amend

Plan: `docs/plans/2026-11-03-the-release-head-reports-validate-with.md` (plan PR #3076, issue #3073). Parent: `docs/plans/2026-11-03-the-release-pr-needs-a-person.md` on origin/main (#3070, issue #3065). Context correction from the caller: this plan is not in sprint `follow-ups-2-30-1`. It starts after release 2.30.1, because its first step is a measurement on the 2.30.1 release head.

## Summary

The plan is a correct Draft placeholder: it chooses no mechanism and stays Draft until the measurement exists. The safety problem is what it leaves out. The plan reduces #3070's three mechanisms to one-line names and does not copy the safety constraints that #3070 attached to each one. #3070's Notes (last bullet) move the CI mechanism to #3073, so after this plan is approved, no plan holds those constraints. The measurement as written also cannot answer its own question safely: after #3070's checks slice ships, `release-approve` never reaches GitHub, and the merging identity on this repository is an admin with ruleset bypass `always`.

## Findings

### F1. The measurement cannot reach GitHub once #3070's checks slice ships (HIGH)

- The plan's Approach (line 37) tells the person to run `plot-ask.mjs release-approve` and record GitHub's answer.
- #3070's Approach says `releaseApprove` "refuses `checks-missing` on this reading before it calls `mergeAt`", and the reading is the PR's `statusCheckRollup` without `plot/review`. On 2.30.0 the dispatched `validate` was absent from that rollup (#3070 Motivation).
- The plan (line 31) and #3070 both say 2.30.1 is cut after #3070 is finished. On the 2.30.1 head, `release-approve` therefore answers `checks-missing` and asks GitHub nothing. Outcome A and Outcome B cannot be told apart.
- Risk: the person improvises a merge to get GitHub's answer. An improvised `gh pr merge --admin`, or a merge as a bypass identity (F2), gives a false Outcome A.

### F2. The merging identity bypasses the ruleset, so a GitHub merge does not prove the ruleset counts the check (HIGH)

Ran: `gh api repos/plot-pm/plot/rulesets/24412719`.

- `bypass_actors`: `RepositoryRole` 5 (admin), `bypass_mode: always`, and `Integration` 5173644 (`plot-build`), `always`.
- `gh api repos/plot-pm/plot/collaborators/jwloka/permission` answers `admin`.
- `plot-config.sh get "Merger app"` answers `none` on this repository. With no Merger app, `plot-host.sh pr-merge` (origin/main `plot-host.sh:4436-4441`) merges as the signed-in `gh` identity.
- `docs/review-status-rollout.md:134-153` (#1730): "A pinned merge by a bypass-capable identity still bypasses every required check."
- The 2.30.0 refusal at about 14:39Z shows that a merge without `--admin` was refused at least once. #1730 records a bypassed merge as the same kind of identity. The two observations disagree. So a GitHub merge in the measurement can mean "the ruleset counts the dispatched check" or "the merger bypassed the ruleset". The plan does not record which identity merges or its bypass mode.
- Consequence for Outcome A: the plan concludes "nothing to build for CI" while the ruleset never bound the merge. That is the lens question "does the ruleset still bind the merge", and the measurement as written cannot answer it.

### F3. Outcome A has no owner (MEDIUM)

- Plan line 39: Outcome A "closes as 'Plot reads the dispatched check', which #3070 owns".
- #3070 Notes, last bullet: "The CI mechanism is not a slice of this plan … The measurement and the mechanism move to #3073." #3070's slices are `the-release-review-is-switched-on`, `the-release-checks-are-counted` and `the-release-head-is-the-version-step`. None widens "what GitHub counts".
- After Outcome A, `release-approve` keeps refusing `checks-missing` on every release head (F1), and the person keeps approving held runs. This is the defect the issue names.

### F4. The verification line excludes one of the three candidate mechanisms (MEDIUM)

- Plan line 42: "with no `actions/runs/<id>/approve` call".
- Candidate 3 (line 29, and #3070 "A controller approves the held run") is that call. Either candidate 3 is out of scope, or the check is wrong. A person must decide this before approval, because candidate 3 has the largest blast radius (F6).

### F5. The plan drops the per-mechanism constraints from #3070 (HIGH)

#3070 attaches these constraints. The child plan carries none of them, and #3070 has handed the mechanism to this plan:

- Relay: its own job with `statuses: write`, no checkout, no install. The job finds the run by event `workflow_dispatch`, path `.github/workflows/ci.yml`, `head_sha == needs.release.outputs.head_sha` and actor `github-actions[bot]`, and zero or two matches fail the job. It writes only `success` or `failure`, only after completion. A timeout fails with no status. It compares the SHA itself and does not trust the run's own pin (`ci.yml:112-127` lives on the unprotected branch).
- Token: never a ruleset bypass actor, never in the `release` job's environment where `pnpm install` (`release.yml:69`) and `pnpm run version` (`release.yml:115`) run, and every new `uses:` SHA-pinned.
- Approval: a `Build` port write in a TypeScript connector, called from `releaseApproveAt` only and never from fleetd. It is pinned to workflow `CI`, event `pull_request`, branch `changeset-release/main`, the base repository and the head SHA. It runs only after the provenance check passes, and answers `unaskable` on Bitbucket and Jenkins.
- All options: `validate` stays required, written under integration 15368.

Without these lines, the slice line "the chosen mechanism reports `validate`" permits an unsafe implementation.

### F6. Approving a held run exposes a bypass actor's key to code on an unprotected branch (HIGH, applies to candidate 3 and to today's manual approval)

Ran: `gh secret list -R plot-pm/plot` and `gh api repos/plot-pm/plot/branches/changeset-release%2Fmain/protection`.

- Repository secrets: `PLOT_BUILD_APP_ID` and `PLOT_BUILD_APP_PRIVATE_KEY`. These belong to `plot-build`, integration 5173644, which is a ruleset bypass actor with `always` (`build-bundles.yml:4-6, 30-33`).
- `changeset-release/main` has no branch protection (404) and no ruleset (`release.yml:127-132`, `ci.yml:36-39`).
- A `pull_request` run uses the workflow file from the merge ref of the head. A writer who pushes a changed `.github/workflows/ci.yml` to the release branch, followed by an approval of the held run, runs that workflow with access to the bypass key. The key can push to `main` past the ruleset.
- #3070's provenance table refuses any path outside the version step's set, so `.github/**` is refused. That bound holds only if the approval pins the run's `head_sha` to the SHA that the provenance check read, and the run's `head_repository` to the base repository. The plan must state both.
- Writers can already open their own same-repository PR and get an unheld run with secrets, so the new exposure is bounded to writers. The real change is that candidate 3 turns a person's look at the run into an unattended act.

### F7. Candidate 2 cannot meet its own constraint as `release.yml` is built (MEDIUM, decision for a person)

- `changesets/action` (`release.yml:111-120`) runs `pnpm run version` and pushes and opens the PR in one step, with one `GITHUB_TOKEN` in its env. `pnpm install` runs earlier in the same job (`release.yml:69`).
- To keep the new token out of the job that runs `pnpm install` and `pnpm run version`, the version step and the push/PR step must split into two jobs.
- If the App only opens the PR while `GITHUB_TOKEN` still force-pushes the branch, a regenerated head raises no `synchronize` run (`ci.yml:20-27`: a `GITHUB_TOKEN` push starts no workflow). The first head is tested, and later heads are not.
- An App installation token lives one hour, against the job token's job lifetime. A dependency lifecycle script under `pnpm install` that reads it gets `contents: write` and `pull-requests: write` for an hour.

### F8. The relay makes a commit status satisfy the required check (LOW, recorded for the decision)

- The ruleset (`required_status_checks`) requires context `validate` from integration 15368. A commit status written with `GITHUB_TOKEN` carries 15368, so the relay's logic becomes the whole required check (#3070 says the same).
- `strict_required_status_checks_policy: false`. `validate` on the head counts even after `main` moves, and the dispatched run tests the branch head, not a merge with the newer `main`. This already holds today and does not change under any candidate.
- The repository default `default_workflow_permissions: read` (ran `gh api …/actions/permissions/workflow`), so `statuses: write` must be explicit in the relay job. That is correct.

### F9. No Bitbucket scope line and no tests (LOW)

- #3070 states "GitHub only" and `unaskable` on Bitbucket. This plan states neither.
- The plan names no test. #3070's CI slice test list ("a head whose only validate is a dispatched check run passes the checks rule" for Outcome A, and a recorded live measurement for each of the other three) should move here.

## Rubric

1. Defect and sprint: the plan names the right defect. It moves toward zero interventions only if F1, F2 and F3 are fixed. Otherwise the measurement cannot answer and Outcome A has no builder. Verification: the PR rollup on the pinned head shows `validate` before `release-approve`, the Actions API shows no person-started `run_attempt` above 1, and the merge identity is not a bypass actor.
2. Claims: the Motivation matches #3070 and the issue. The claim "which #3070 owns" (line 39) is false (F3).
3. Left half-done: F3 (no owner), F5 (constraints dropped), the `ci.yml:30-33` and `release.yml:141-159` comment corrections that #3070 assigns to "the CI slice", which now lives here and is not named.
4. Failure modes: an improvised merge during the measurement (F1, F2) gives a silent wrong answer. A relay or approval for the wrong SHA is bounded only by constraints this plan does not carry (F5, F6).
5. Unattended build: no agent can build the slice until a person chooses the mechanism. The plan says so. After the choice, an agent still needs the F5 constraints in this plan. Decisions for a person: F4, F7, the merging identity (F2), and any ruleset change.
6. Tests: none named (F9).

## Required amendments

1. Measurement (F1, F2): state how GitHub's answer is asked when `release-approve` refuses `checks-missing`. Prefer a read that merges nothing: `gh pr view <pr> --json mergeStateStatus,statusCheckRollup` and the head's check runs, after the dispatched `validate` succeeds and before any approval. If a real merge is the probe, it is `gh pr merge <pr> --match-head-commit <sha>` with no `--admin`, as an identity that is not in `bypass_actors`, and after the provenance check passes. Record the merging identity and its bypass mode with the result.
2. Outcome A owner (F3): make "Plot reads the dispatched check" this plan's slice under Outcome A, with #3070's test "a head whose only validate is a dispatched check run passes the checks rule". Plot's reader must not count more than the ruleset counts: context `validate`, integration 15368, on the pinned head.
3. Verification (F4): either drop candidate 3, or change line 42 to "no `actions/runs/<id>/approve` call by a person" and say what proves that.
4. Constraints (F5): copy #3070's per-mechanism constraints into this plan's Design. Add the invariant: `validate` stays required with integration 15368, no new bypass actor, and `strict_required_status_checks_policy` is unchanged.
5. Approval pin (F6): if candidate 3 stays, the approved run's `head_sha` equals the SHA that the provenance check read, and its `head_repository` equals the base repository. Otherwise it refuses by name, before the approve call.
6. Token shape (F7): if candidate 2 is chosen, the Decision names the job split and which identity pushes the branch, so every regenerated head gets a run.
7. Scope and tests (F9): add "GitHub only; `unaskable` on Bitbucket and Jenkins", and move #3070's CI slice test list and its two comment corrections into this plan.

## Decisions for a person

- Candidate 3 in or out (F4), given F6.
- Which identity merges the release PR on this repository: declare `Merger app`, or accept that the admin merge bypasses the ruleset (F2). This decides whether "the ruleset binds the merge" can be true at all.
- Candidate 2's job split, if chosen (F7).
- Any ruleset change, and who makes it (plan Open Question 3). No candidate should need one. A change that adds a bypass actor or removes `validate` is out of scope.

## What I ran versus read

Ran (read-only): `gh issue view 3073`; `git show origin/main:` for the parent plan, `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `.github/workflows/build-bundles.yml`, `packages/domain/src/workflows/release-approve.ts`, `packages/domain/src/workflows/merge.ts:195-210`, `skills/plot/scripts/plot-host.sh:4436-4445`, `docs/review-status-rollout.md:134-160`; `gh api repos/plot-pm/plot/rulesets/24412719`; `gh api …/branches/changeset-release%2Fmain/protection` (404); `gh api …/actions/permissions/workflow`; `gh api …/collaborators/jwloka/permission`; `gh secret list`; `gh api …/environments`; `plot-config.sh get "Merger app"`; `gh pr list` for #3070's slice branches (none merged yet); a grep of the controller gate bundle for merge pinning.

Read only, not executed: whether GitHub holds `pull_request` runs on an App-authored PR (candidate 2), and whether a GraphQL merge by an admin without `--admin` is bound by the ruleset (the 2.30.0 refusal says yes once, #1730 says a bypass merge happened). No test suite, host write, fleet or board command was run.
