# Seams juror: the-release-pr-needs-a-person

Position: amend

Lens: the edges between Plot and GitHub — the changesets action and its token, the bot-PR approval hold, `workflow_dispatch` versus `pull_request` status reporting, the ruleset's required checks, fleetd's release review arm, and the release docs.

## Summary

The plan names the right two gaps, but its diagnosis of both is wrong in a way that changes the work. The review gap already has a measured cause: `Auto-review` is absent from this repository's Plot Config, so fleetd chose `review` 53 times and started none. The CI gap has two readers, not one: the dispatched run does write a `validate` check run on the head, but the PR's `statusCheckRollup` excludes it, so Plot's own `merge()` refuses `checks-not-green`. Whether GitHub's ruleset accepts the dispatched check is unmeasured, because no release so far retried the merge after the dispatched run finished and before a person approved the held run. The plan must state both readers, add the measurement as the CI slice's first step, and give the review decision to a person.

## Findings

### F1. The review gap has a measured cause: `Auto-review` is off (rubric 1, 2, 5)

- `packages/fleet/src/server/entry/registryd-main.ts:3070` reads `readAutoReview(boardOpts).autoReview` and passes it to `releaseTick` as `reviewEnabled` (`:3098`).
- `packages/fleet/src/shared/auto-review.ts:55-57`: absent, unreadable or any value but `true` is off.
- `CLAUDE.md` `## Plot Config` on origin/main has no `Auto-review` key (it has `Auto-verify` and `Auto-design` at lines 105 and 107).
- `packages/fleet/src/shared/release-tick.ts` starts a review only on `step.step === 'review' && reviewEnabled`. With `reviewEnabled` false, it returns the step and writes no run-log line.
- `registryd-main.ts:3103` still prints `plot-fleetd: release <stage>: review` for that step. `.plot/logs/fleetd.log*` holds 53 `release preparing: review` lines, and this machine has no `.plot/state/release-review.log` and no `.plot/state/run-log.tsv`. Every one of the 53 choices started nothing.
- The plan's open question 1 ("why did fleetd not start a review") therefore has an answer now, and it is not one of the three the plan lists (not started, failed, head moved). It is "switched off by config".

Consequence: the review slice is a decision, not an investigation. Either (a) set `Auto-review: true` in this repository, which also turns on fleetd's review of every slice PR and spends model budget, or (b) start the release review independently of `Auto-review`. (a) is a config change a person makes. (b) is a code change at `registryd-main.ts:3098`, and it contradicts the comment at `:3065-3067`, which says that a repository with review off gets the notice and no agent.

The log line also misleads: `release preparing: review` reads as a start. Whichever option is chosen, the line must say when no start happened (for example `review (Auto-review off)`).

### F2. The dispatched run writes `validate`; the PR rollup does not show it (rubric 2)

The plan says (Motivation item 2, and Approach) that "the `workflow_dispatch` run on the same head reports no `validate` check to the PR". Measured on #2934's head `14d28a09`:

- `GET /commits/14d28a09/check-runs`: two `validate` check runs from app `github-actions`. One is in check suite `112877067409` (the `workflow_dispatch` run `41655186640`), `success`, completed 14:47:21Z. The other is in suite `112877021845` (the `pull_request` run `41655170108`), `success`, completed 15:00:00Z.
- Both check suites report `pull_requests: []`.
- On 2.29.1 (#2810), `plot-ask.mjs merge 2810 46a92390…` at 2026-10-29T13:08:09Z refused `checks-not-green`, with the detail `the checks of PR #2810 read 'none'`. The dispatched `validate` on that head had completed `success` at 12:57:38Z, 11 minutes earlier.
- `pr-state` derives `checks` from `gh pr view --json statusCheckRollup` (`skills/plot/scripts/plot-host.sh:4087-4089`), and `merge()` refuses on `pr.checks !== 'green'` (`packages/domain/src/workflows/merge.ts:203-204`). `release-approve` reaches the same check through `mergeAt` (`packages/domain/src/workflows/release-approve.ts:143`).

So the correct statement is: the dispatched run reports `validate` on the head commit, but the PR's rollup does not include it, and Plot's merge reads the rollup. That is a Plot-side reader gap. It exists whatever GitHub's ruleset does.

### F3. Whether the ruleset accepts the dispatched `validate` is unmeasured (rubric 1, 2, 4)

- Ruleset `24412719` on `~DEFAULT_BRANCH` requires `validate` with `integration_id: 15368` (GitHub Actions) and `plot/review` with `integration_id: 5317669`. The dispatched check run comes from app `github-actions`, so on paper it matches.
- On 2.30.0 the host refusal (`the base branch policy prohibits the merge`, 14:39:41Z) came while the dispatched run was still in progress. It completed at 14:47:21Z. The person approved the held run at 14:47:31Z, 10 seconds later, and did not retry the merge in between.
- On 2.29.1 the host refusal at 13:29:20Z came after the approved run was green and before `plot-review` ran (13:30:27Z). That refusal was the missing `plot/review`, not `validate`.
- Neither release therefore shows the ruleset refusing a head that had only a green dispatched `validate`.

The plan's open question 3 is the right question, but the plan treats the answer as "no" when it writes "the run still does not report `validate` to the PR". The answer decides the slice: if the ruleset accepts the dispatched check, the fix is in Plot's reader (F2) and no workflow, token or approval changes. If it does not, a workflow-side mechanism is needed as well.

The earlier plan already asked for this measurement (`docs/plans/2026-10-29-the-release-waits-for-one-approval.md:41` and `:70`) and suspected Plot's own fold, not the ruleset. Delivery did not record a result. This plan should cite that and close it.

### F4. Approving the held run costs a full CI round and re-blocks the merge (rubric 4)

- On 2.30.0 the approval at 14:47:31Z started a new `pull_request` run whose aggregate `validate` completed at 15:00:00Z. The merge landed at 15:00:24Z.
- On 2.29.1 the approval at 13:08:40Z came 11 minutes after the dispatched `validate` was already green. The approved run's `validate` completed at 13:28:57Z.

Mechanism 3 (approve from a controller) therefore adds 12 to 20 minutes per release head and creates a newer `validate` check run, pending while that run lasts. The plan lists the credential cost of mechanism 3 but not this one.

### F5. Mechanism 1 is under-specified at three seams (rubric 3, 4, 5)

- `dispatch-ci` is fire-and-forget: `gh workflow run` (`.github/workflows/release.yml`, the `dispatch-ci` step) returns before the run starts. A status that mirrors the run's result needs either a job that waits for the dispatched run, or a separate `workflow_run` workflow. The plan names neither. A `workflow_run` trigger on a run that `GITHUB_TOKEN` dispatched must be measured, because `GITHUB_TOKEN` events start no workflow except `workflow_dispatch` and `repository_dispatch` (the plan's own source, `ci.yml:8-27`).
- A commit status needs `statuses: write`, and a check run needs `checks: write`. Neither is in `dispatch-ci` today (`permissions: actions: write`). The open question names only `actions: write`.
- Whatever writes `validate` must copy the dispatched run's own conclusion for the pinned `expected_sha`. It must never write `success` before the run ends, and never for a SHA other than the head `release.yml` read. Otherwise it forges the one required gate.
- A commit status appears in `statusCheckRollup`, but a dispatched check run does not (F2). The choice between status and check run therefore also decides whether F2 is fixed as a side effect. The plan must say which, and that the status's creator must match `integration_id: 15368`.

### F6. Mechanism 2 needs decisions only a person can make (rubric 5)

- A non-`GITHUB_TOKEN` credential for `changesets/action` means a GitHub App or PAT, a new Actions secret, and a new `uses:` step to mint the token (for example `actions/create-github-app-token`), which must be SHA-pinned like every other step in `release.yml`.
- The ruleset lists `Integration 5173644` with `bypass_mode: always`. If the release credential is that App, or any bypass actor, a push or merge with it skips `validate` entirely. The plan must require a non-bypass identity.
- Whether a same-repository PR that an App authors is still held at `action_required` is unmeasured. The hold is observed for `app/github-actions` only.

### F7. Board impact is not "none" (rubric 3)

The board's release row reads `checks` from the rich listing, which folds the same `statusCheckRollup` (`plot-host.sh:4660-4672`). On a head with only the dispatched run, the row reads `none` today. A fix in Plot's reader (F2) or a commit status (F5) changes what the release row shows. `releaseStage` in `packages/domain/src/rules/release-prepare.ts:215-221` reads runs through the Build port, not the rollup, so the board's stage and the merge's check can disagree on the same head. The Changelog's "Board impact: none expected" needs to name this.

### F8. Docs and comments that state the old belief (rubric 3)

- `.github/workflows/ci.yml:30-33` says "A dispatched run creates its check runs under the job name `validate`, which is the context the branch protection requires, so the required check reports and the merge stays a human act". The first half is true. The plan must correct the second half, or confirm it with the F3 measurement.
- `.github/workflows/release.yml` (the `dispatch-ci` header comment) says the same.
- The CI slice changes neither skill nor helper script as listed. If it changes `plot-host.sh` (F2), the shell-lines ratchet (`scripts/check-shell-lines.sh`) and bash 3.2 (`scripts/check-bash32-syntax.sh`) apply, and the Bitbucket arm of `pr-state` must keep its current answer.

### F9. Testability of the CI slice (rubric 6)

- GitHub's ruleset and Actions behaviour cannot be tested in a unit test or in CI before merge. The acceptance is the next live release PR. The plan must say so, and must say who observes it.
- An unattended agent cannot run the F3 measurement: it needs a release PR at a green dispatched head and a merge attempt, which is a host write a person authorises (`release-approve` refuses `unattended`).
- A Plot-reader fix (F2) is testable: a `pr-state` fixture with an empty rollup and a green `validate` check run on the head, asserting `checks: green` and `checksSha` equal to the head. It fails before the change and passes after.
- For the review slice: a `releaseTick` test with `reviewEnabled = false` that asserts the outcome names why no start happened, and, for option (b), a test that the release review starts with `Auto-review` absent.

## Required amendments

1. Replace Motivation item 2 and the Approach's "the run still does not report `validate`" with the measured facts in F2 and F3: the dispatched `validate` check run exists on the head, the PR rollup omits it, Plot's `merge()` reads the rollup, and the ruleset's answer is unmeasured.
2. Make the CI slice's first step the F3 measurement, run by a person on the next release head: wait for the dispatched `validate` to read `success`, do not approve the held run, run `release-approve`, and record the refusal or the merge. Name the two outcomes and the work each one selects. If the ruleset accepts, the slice changes only Plot's checks reader for the required check names and touches no workflow.
3. Answer open question 1 with F1. Turn the review slice into a named decision for a person: `Auto-review: true` for this repository, or a release review independent of `Auto-review`. Fix the `release preparing: review` log line either way.
4. Add the F4 cost to mechanism 3, and the F5 and F6 specifics to mechanisms 1 and 2: the wait or `workflow_run` question, the `statuses:`/`checks:` permission, conclusion mirroring pinned to `expected_sha`, `integration_id: 15368` attribution, and a non-bypass identity.
5. Replace "Board impact: none expected" with F7.
6. List the comments in F8 as files the CI slice updates.
7. State the scope as GitHub only (the changesets action and the Actions approval have no Bitbucket or Jenkins arm), and say what a Bitbucket repository's release PR gets: no change.

## Decisions that need a person

- Whether fleetd may start the release review in this repository: switch `Auto-review` on for every PR, or exempt the release review from it.
- Which identity opens the release PR, if mechanism 2 is chosen, and that it is not a ruleset bypass actor.
- Whether a controller may approve a held Actions run at all (mechanism 3), since it acts on a run nobody read and spends a CI round.
- Running the F3 measurement on a live release head.

## What I ran and what I only read

Ran (read-only):
- `gh issue view 3065`, `gh pr view 2934` (checks rollup, comments), `gh pr view 2962`, `gh pr list --head changeset-release/main --state merged`.
- `gh api repos/plot-pm/plot/actions/runs?head_sha=…` and `commits/<sha>/check-runs` and `check-suites` for the heads of #2934, #2810, #2452 and #2351.
- `gh api repos/plot-pm/plot/rulesets` and `rulesets/24412719`; `branches/main/protection` (404).
- `git show origin/main:` for `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `release-prepare.ts`, `release-tick.ts`, `auto-review.ts`, `registryd-main.ts:3055-3110`, `merge.ts`, `release-approve.ts`, `plot-host.sh` (pr-state and the rich-listing fold), and the 2026-10-29 plan.
- `grep` over `.plot/logs/fleetd.log*` for the release arm's lines, and a listing of `.plot/state/`.
- A Python read of this session's transcript for the 2026-10-29 and 2026-11-03 release commands and their results, which gave the timestamps in F2 to F4.

Only read, not executed: every code path. I did not run a test, a fleet or board command, or any host write.
