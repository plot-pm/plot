# Juror: layering

Position: amend

Lens: where each responsibility lives — `release.yml`, `ci.yml`, the review controller (`reviewPr` / `startReview` / the release arm), the `release-approve` controller, and which component makes the release PR carry its checks.

## Summary

The plan names the right two gaps, but it places both causes in the wrong component. The review gap has a measured cause in config, not in fleetd's code. The CI gap repeats a measurement the predecessor plan required and never recorded, and the plan omits the competing cause that the predecessor named: Plot's own fold of `ACTION_REQUIRED`, not GitHub's ruleset. The two slices are also not independent: the release arm starts a review only after the required workflow reads green. Of the three CI mechanisms, two belong in the CI layer and one belongs behind the Build port. The plan does not say which layer owns the decision, so an unattended agent can put it in a controller or in a workflow step with equal plausibility.

## Findings

### F1. The review gap has a measured cause: `Auto-review` is off on this repo

- `registryd-main.ts:3071` reads `readAutoReview(boardOpts).autoReview`, and `release-tick.ts:118` starts the release review only `if (step.step === 'review' && reviewEnabled)`.
- `auto-review.ts:55-57` answers `false` for an absent key. `skills/plot/scripts/plot-config.sh get Auto-review UNSET` prints `UNSET`, and `git show origin/main:CLAUDE.md | grep -c Auto-review` prints `0`.
- So on 2026-11-03 the release arm could compute `{ step: 'review' }` and start nothing. It also wrote no run-log line, because the `review` branch at `release-tick.ts:118` is skipped and the function falls through to `return { stage, step }`.
- The plan's open question 1 ("not started, started and failed, or head moved") omits this fourth cause, which is the one the code shows. The fix is a person's decision: `Auto-review: true` also starts reviews on every slice PR, not only the release PR. A separate release-only switch is a new config key. Neither choice belongs to an unattended agent.

### F2. The slices are ordered, not independent

- `release-prepare.ts:259` returns `none('checks-…')` before the review question when the required workflow is not green, and `:260` returns `none('not-asked')` when the index row carries no `plotReview` field.
- So the review slice can only be observed working once the CI reading is green. The plan's "Two independent gaps, so two slices" is false at this seam. A verifier of the review slice needs a head whose `CI` run succeeded.

### F3. Two components answer "are the head's checks green" differently

- `releaseStage` reads `Build.runsForSha` through `release-world.ts:68-71` and calls the head green when ANY `CI` run on it succeeded (`release-prepare.ts:185`). The dispatched run satisfies that, so the board shows the release `ready`.
- `releaseApproveAt` merges through `mergeAt` (`release-approve.ts:143`), which refuses `checks-not-green` from the host's rollup (`merge.ts:203`). `plot-host.sh:4669` folds `ACTION_REQUIRED` into `failing` on purpose.
- The predecessor plan named exactly this (`docs/plans/2026-10-29-the-release-waits-for-one-approval.md:41`): "The merge refuses only because `plot-host.sh` folds `ACTION_REQUIRED` into `failing` … and `merge()` then refuses `checks-not-green`." It also decided (`:70`) that "the rule reads the ruleset's required checks by name, not the folded rollup" and that a run-approval write is built only if a measurement shows it is needed. PR #2962 records no such measurement.
- The new plan does not cite either line. Its Motivation states as fact that "GitHub refused the merge" and that the dispatched run "reports no `validate` check to the PR". The refusal text is not recorded in the issue or the plan, so a reader cannot tell a Plot refusal (`checks-not-green`) from a host refusal (`host-refused`).

### F4. The dispatched run DOES put a `validate` check run on the head

Measured through the Actions API (read only):

| Release | Head | Dispatched `validate` success | PR run approved (attempt 2 start) | Merged |
|---|---|---|---|---|
| 2.30.0 #2934 | `14d28a09` | 14:47:18 (suite 112877067409) | 14:47:32 | 15:00:24 |
| 2.29.1 #2810 | `46a92390` | 12:57:38 | 13:08:40 | 13:30:42 |
| 2.29.0 #2452 | `d7c65b08` | 04:58:56 | 05:45:38 | 06:05:36 |

- On all three heads a `validate` check run from app `github-actions` (the ruleset's `integration_id: 15368`) concluded `success` before a person approved the held run. The ruleset (`rulesets/24412719`) requires `validate` from 15368 and `plot/review` from 5317669, with `strict_required_status_checks_policy: false`.
- So "the run still does not report `validate` to the PR" (plan Motivation, last paragraph) is false as stated. The open question is whether GitHub's merge gate, or Plot's rollup fold, refused despite that check run. On #2934 the approval came 14 s after the dispatched `validate` finished, so that refusal may simply have been a pending check. The `release-approve` receipt reads `2026-11-03T14:18:54Z`, before the 14:35:16 force-push, so at least one attempt was on an earlier head.

### F5. Where each CI mechanism lives, by the layering rule

- Mechanism 1 ("dispatch-ci creates the commit status or check run"): `dispatch-ci` holds `actions: write` only (`release.yml:160-165`). A status written from it needs `statuses: write` or `checks: write`. It would report `validate` from `release.yml` without running the tests, which moves the verdict out of `ci.yml`. A `GITHUB_TOKEN`-written status is also attributed to integration 15368, so it would satisfy the ruleset with no test run behind it. This option forges the check unless the job waits for the run's result. If F4 holds, mechanism 1 is also redundant: the check run already exists.
- Mechanism 2 (a non-`GITHUB_TOKEN` credential for `changesets/action`): this lives in `release.yml`'s `release` job, which publishes to npm under OIDC. Adding an app private key to that job is the widening that `release.yml:46-49` records as the rejected alternative. The plan must say which job holds the credential.
- Mechanism 3 (a controller approves the held run): a run approval is a write to the build system. In this estate that is the `Build` port (`ports/build.ts`, beside `rerunFailed`/`rerunAll` at `:135-149`) and a TypeScript connector, with `unaskable` on Jenkins and Bitbucket, as the predecessor plan already decided (`:70`). It must not be a new `gh api` call in a script (the `check-host-cli-callers.sh` gate) and must not run from fleetd unattended. Inside `release-approve` it runs under the person's call, which keeps "the one step a person takes". The cost is that the merge then waits on a 12-25 min run, so `release-approve` either refuses `checks-pending` by name after the approval or blocks. The plan does not choose.

### F6. The domain should own the release PR's check reading

- Whatever mechanism wins, `releaseStage` (`release-prepare.ts:179-186`) and `mergeAt` (`merge.ts:203`) must read the same answer. Otherwise the board reads `ready` and `release-approve` refuses, which is the 2026-11-03 shape. The layering rule says every rendered state is a domain property; here the rendered `ready` and the controller's refusal come from two different readings.
- A named refusal for the release path belongs in `ReleaseApproveRefusal` (`release-approve.ts:17`). Today a CI gap surfaces as `checks-not-green` from `mergeAt` or as `host-refused` with the host's words. Neither tells the person which of the three causes holds.

## Required amendments

1. **Record the refusal before choosing a mechanism.** The CI slice first records, for the next release head, what `plot-ask.mjs release-approve` prints (`checks-not-green` vs `host-refused` and the host's words) after the dispatched `validate` concluded, and the PR's rollup `checks` value at that time. Cite the F4 table and `docs/plans/2026-10-29-the-release-waits-for-one-approval.md:41,70` in the Motivation, and correct the claim that the dispatched run reports no `validate`.
2. **Add the fold as a fourth candidate cause and fix it in the domain if it is the cause.** If the refusal is Plot's `checks-not-green`, the fix is in the domain: the release PR's check reading names the ruleset's required contexts (`validate`) on the head and does not fold a held `pull_request` suite into `failing`. `releaseStage` and `releaseApprove` read that one rule. No credential and no CI change follows.
3. **Name the owning layer of each remaining mechanism.** Drop mechanism 1 unless it waits for the run's conclusion and the plan states which permission it adds to which job. For mechanism 2, name the job and the credential. For mechanism 3, state that it is a `Build` port write in a TypeScript connector, called from `releaseApproveAt` only (never fleetd), pinned to workflow `CI`, event `pull_request`, branch `changeset-release/main`, the base repository and the head SHA, with `unaskable` on Jenkins and Bitbucket, and add `checks-pending` to `ReleaseApproveRefusal`.
4. **Replace open question 1 with the measured cause.** State that the release arm starts nothing while `Auto-review` is absent (`registryd-main.ts:3071`, `release-tick.ts:118`, `auto-review.ts:55-57`), and add one run-log line for a `review` step skipped by the switch, so the next skip is visible in the log.
5. **State the slice order.** The review slice waits on the CI slice, or its verification names a head whose `CI` run already succeeded (`release-prepare.ts:259`).
6. **Board impact.** Remove "Board impact: none expected". If amendment 2 lands, `releaseStage` changes its input, and the board's release row shows that stage.

## Decisions that need a person

- D1: Turn on `Auto-review: true` for this repo (slice PRs too), or add a release-only switch. This is a config and cost decision.
- D2: Whether `release-approve` may approve a held `pull_request` run as part of the person's approval (mechanism 3), and whether it then blocks or refuses `checks-pending`.
- D3: Whether a non-`GITHUB_TOKEN` credential may enter `release.yml`, and in which job (mechanism 2).

## What I ran versus what I only read

Ran (read-only): `gh issue view 3065`; `gh pr view 2934` (rollup); `gh api` for the actions runs and check runs on the heads of #2934, #2810 and #2452, the run details, the ruleset `24412719` (rules and bypass actors), the #2934 timeline and commit statuses; `gh pr list --head changeset-release/main`; `gh pr view 2962`; `skills/plot/scripts/plot-config.sh get Auto-review` and `get "Default branch checks"`; `git show`/`git grep` on `origin/main`; reading `.plot/state/action-receipts/release-approve`.

Read only: `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `packages/domain/src/rules/release-prepare.ts`, `packages/domain/src/workflows/release-approve.ts`, `packages/domain/src/workflows/merge.ts`, `packages/fleet/src/shared/release-tick.ts`, `packages/fleet/src/shared/release-world.ts`, `packages/fleet/src/shared/auto-review.ts`, `packages/fleet/src/server/entry/registryd-main.ts:3040-3120`, `skills/plot/scripts/plot-host.sh:4640-4700`, `docs/plans/2026-10-29-the-release-waits-for-one-approval.md`.

Not measured: whether GitHub's merge gate accepts the dispatched `validate` check run alone. I made no host write and no merge attempt, so F4 shows that the check run exists, not that the ruleset counts it.
