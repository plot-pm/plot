# Testability juror: the-release-pr-needs-a-person

Position: amend

## Summary

The plan has no test plan. It names two slices and four open questions, and it names no test, no failing-before assertion and no acceptance measurement. Through this lens that alone requires an amendment. The measurements below also show that the review slice's cause is already knowable from the source and the fleetd log, and that the CI slice's premise ("the `workflow_dispatch` run reports no `validate` check") is false as stated at the commit level. Both facts change what a test must prove.

## Findings

### F1. The review cause is `Auto-review` off, and it is visible today

- `packages/fleet/src/shared/release-tick.ts:118` starts a review only when `step.step === 'review' && reviewEnabled`. Otherwise it returns `{ stage, step }` with no run-log line and no refusal.
- `registryd-main.ts` (release arm, origin/main around line 3069) passes `readAutoReview(boardOpts).autoReview`. `packages/fleet/src/shared/auto-review.ts:55` reads `Auto-review` and answers off when the key is absent. The repo `CLAUDE.md` `## Plot Config` has no `Auto-review` key (grep on origin/main: 0 hits).
- `.plot/logs/fleetd.log` on this machine holds `plot-fleetd: release preparing: review` 35 times and `release ready: notify` once. No `.plot/state/release-review.log` exists. So the rule selected `review` 35 times and fleetd started none.
- Consequence for tests: the open question "why did fleetd not start a review" is answered, and the answer is a configuration decision, not a defect a Sonnet agent can "fix". A test that fails before the change exists only if the plan decides the behaviour: either the release review ignores `Auto-review` (test: `releaseTick(..., reviewEnabled=false)` with a `review` step still calls `startReview`; this fails today on `release-tick.ts:118`), or the release review stays gated and the plan sets `Auto-review: true` in config (no code test; the proof is a `release-review` run-log line on the next release).
- Silent failure mode: with review off, the log line reads `release preparing: review` while nothing starts. `packages/fleet/test/unit/release-tick.test.ts` has three cases (lines 82, 93, 106) and none covers `reviewEnabled=false`. A named outcome (for example a `release-review` run-log line with outcome `skipped: auto-review-off`) would make this testable and visible.

### F2. The dispatched run DOES create a `validate` check run on the head

Measured with read-only `gh api` calls on 2026-11-03:

- Head `14d28a0974216bc44c88378345c5021e778edac8` (#2934) carries two `validate` check runs from app `github-actions`: check suite `112877067409` from `workflow_dispatch` run `41655186640` (success, completed 14:47:21Z), and check suite `112877021845` from `pull_request` run `41655170108` (attempt 2, started 14:47:32Z by jwloka, success 15:00:00Z).
- The ruleset `24412719` requires `validate` with `integration_id 15368` (github-actions) and `plot/review` with `integration_id 5317669`. Both suites come from integration 15368.
- The PR's `statusCheckRollup` lists only the `pull_request` suite's checks.
- 2.29.1 (`46a92390`): dispatched `validate` green at 12:57:38Z; the person approved the held run at 13:08:40Z. 2.29.0 (`d7c65b08`): dispatched green 04:58:56Z; approval 05:45:38Z. 2.28.1 (`eb6d778e`): dispatched green, `pull_request` attempt 2 failed, merged anyway.

So the plan's sentence "The `workflow_dispatch` run on the same head reports no `validate` check to the PR" (plan line 26, issue #3065) is false at the commit level and unproven at the PR level. For #2934 the person approved the held run 11 seconds after the dispatched `validate` finished, so the merge refusal may have been a pending check, not a missing one. For 2.29.1 and 2.29.0 a green dispatched `validate` existed for 11 and 47 minutes before the approval, which suggests GitHub does not count it, but no merge-refusal text or timestamp is recorded anywhere.

Consequence for tests: the CI slice's decision rests on a GitHub behaviour that no unit test can reproduce. The plan must require the measurement before the choice, with the evidence named (see A2).

### F3. fleetd's `ready` disagrees with GitHub's mergeability, and that part IS unit-testable

- `packages/domain/src/rules/release-prepare.ts` `requiredChecks` (around line 186) answers `green` when any run of the `CI` workflow on the head succeeded. The dispatched run satisfies it. `releaseStage` then answers `ready` and fleetd notifies "ready to approve".
- If GitHub refuses the merge while the `pull_request` run is held, fleetd tells the person the release is ready while `release-approve` will fail at the host. The person then approves the run by hand, which is exactly the intervention the sprint removes.
- Whatever mechanism the CI slice picks, the domain must read the check GitHub enforces (the `validate` check run that the ruleset counts, or a held `action_required` run on the head), not "any CI run succeeded". That is a pure-function test in `packages/domain/test/release-prepare.test.ts`: a reading with one successful `workflow_dispatch` run and one `action_required` `pull_request` run answers `preparing` (or a named hold), not `ready`. It fails today. `ReleaseChecksReading` carries `workflow`, `status`, `conclusion` and no `event`, so the reading needs one more field; the plan does not say so.

### F4. Only GitHub can prove the CI slice, and the plan names no acceptance check

The three candidate mechanisms each end in a GitHub-side fact: a commit status or check run the ruleset accepts, a non-held `pull_request` run, or an approved run. None runs in `test:contracts` or vitest. The `release.yml` change is shell inside YAML; the repo's gates (`check-bash32-syntax.sh`, shell-lines ratchet) do not read workflow files, so nothing local fails before or passes after. The plan must name the proof on the next real release (A3), or the slice delivers with no evidence.

### F5. "A release needed no person before release-approve" has no defined measurement

The plan's headline claim needs a check a reader can run after the next release. All facts exist on the Actions and statuses APIs today:

- every workflow run on the release head SHA has `triggering_actor` that is not a person, and no `pull_request` run has `run_attempt > 1` started by a person (`gh api repos/<o>/<r>/actions/runs?head_sha=<sha>`);
- the `validate` check run the merge used and the `plot/review` status both exist on the head before the `release-approve` call time;
- the run log carries a `release-review` line with outcome `moved` for that head (proves fleetd, not a person, started the review);
- the `release-approve` receipt is the only person action between the release head's force-push and the merge.

## Required amendments

- A1. Answer open question 1 in the plan from F1: fleetd selected `review` 35 times and started none because `Auto-review` is off. Record the decision (see the decision for a person below) and name the test that fails before: `release-tick.test.ts` "a review step starts the release review when Auto-review is off" (if the release review becomes independent of `Auto-review`), plus a test that a skipped start writes a named run-log outcome instead of nothing.
- A2. Make the CI slice's first step a recorded measurement with stated evidence: on the next release head, call the merge (or read `mergeStateStatus` / the ruleset evaluation) after the dispatched `validate` is green and before any person approves the held run, and record the host's answer and timestamps in the plan. Correct plan line 26: the dispatched run creates a `validate` check run on the head (suite `112877067409` on `14d28a09`); the open question is whether the ruleset counts it while a `pull_request` run is held.
- A3. Add a `## Test plan` (or extend `## Slices`) naming, per slice, (a) the unit test that fails before the change and passes after, with file and case name, and (b) the GitHub-side acceptance check from F5, run on the first release after delivery. Delivery of the CI slice waits on (b).
- A4. Add the domain test from F3: `releaseStage` must not answer `ready` on a head where the check GitHub enforces is absent or held, and `ReleaseChecksReading` gains the field that tells the two runs apart (event, or the check-run name the ruleset requires). This also keeps the board button and the notify honest.
- A5. Name the refusal for a held run. If `release-approve` reads a held `action_required` run on the head, it refuses by name (for example `checks-held`) before it calls the host, rather than surfacing GitHub's merge error. Test in `packages/domain/test/workflows-release-approve.test.ts`.

## Decisions that need a person

- Whether the release review runs regardless of `Auto-review`, or this repo sets `Auto-review: true`. The first changes behaviour for every adopting repository; the second starts fleetd reviews on every slice PR here.
- Whether the CI fix may use a credential other than `secrets.GITHUB_TOKEN` (mechanism 2) or let a controller approve a held run (mechanism 3). Both are security choices, not implementation details.

## Ran versus read

Ran (read-only): `gh issue view 3065`; `gh pr view 2934 --json statusCheckRollup`; `gh api` for workflow runs by head SHA on #2934, #2810, #2452, #2351; check runs and check suites on `14d28a09`; run attempts and `triggering_actor`; the issue timeline of #2934; the repo rulesets; `git show`/`git grep` on origin/main; `grep` over `.plot/logs/fleetd.log` and `.plot/state/`.

Read only: `release.yml` (`dispatch-ci`), `ci.yml` header, `release-prepare.ts`, `release-tick.ts`, `release-world.ts`, `review-run.ts`, `auto-review.ts`, `pr-index.ts` (`reviewReaskPrNumbers`), the release arm in `registryd-main.ts`, the earlier plan `2026-10-29-the-release-waits-for-one-approval.md`, the sprint file.

Not done: no test suite, no merge attempt, no host write. I could not read the merge refusal text for #2934 or the times of the merge attempts; the claim that GitHub refused while a green dispatched `validate` existed stays unproven.
