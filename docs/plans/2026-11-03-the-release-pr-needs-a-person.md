# The release PR needs a person for its review and its CI

> The release PR carries a passing `validate` check and a `plot/review` status on its head without a person, so `release-approve` is the only step a person takes.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3065
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- The release PR (`changeset-release/main`) reports `validate` and `plot/review` on its head with no person's action, so `plot-ask.mjs release-approve <pr> <sha>` merges it without a prior manual review run or CI-run approval.

Board impact: none expected. The board's release row reads the check and review state of the head; this plan changes how those two states come to exist, not their shape. Confirm during design.

## Motivation

On 2026-11-03 `plot-ask.mjs release-approve 2934 <sha>` refused release PR #2934 twice before it merged (issue #3065):

1. `review-missing`: nothing reviews a `changeset-release/` head, so a person ran `plot-review.mjs 2934`.
2. GitHub refused the merge, because main's ruleset requires `validate`. The changesets bot's `pull_request` CI run waits as `action_required`. The `workflow_dispatch` run on the same head reports no `validate` check to the PR. A person approved the waiting run with `gh api -X POST repos/plot-pm/plot/actions/runs/<id>/approve`.

Release 2.29.1 needed the same CI-run approval on 2026-10-29. Two of the last two releases therefore needed a person for work that is not the release decision.

[The release waits for one approval](2026-10-29-the-release-waits-for-one-approval.md) set the goal that `release-approve` is the one step a person takes. [The release PR is checked before it merges](2026-10-01-the-release-pr-is-checked-before-it-merges.md) added the `dispatch-ci` job in `.github/workflows/release.yml`, which dispatches `ci.yml` on `changeset-release/main`. The dispatch exists and the run still does not report `validate` to the PR, so the gap is in how the result attaches to the head, not in whether CI starts.

## Design

### Approach

Two independent gaps, so two slices.

**Review.** `release-approve` refuses `review-missing` when `plot/review` is not `success` on the head. The earlier plan has fleetd start the review of the release PR's head once the sprint scope is Delivered. On 2026-11-03 no review existed. The slice finds out why fleetd did not review the head of #2934 (not started, started and failed, or head moved after it started) and fixes that cause. Reading `plot-review.mjs` and the fleetd release pass comes first.

**CI.** `validate` must appear as a check on the PR head. The slice has three candidate mechanisms, to be chosen against `MANIFESTO.md` and measured:

- Make the dispatched `workflow_dispatch` run report a `validate` check against the head SHA, for example by creating the commit status or check run for the head from the `dispatch-ci` job.
- Open or update the release PR with a credential that is not `secrets.GITHUB_TOKEN`, so the `pull_request` run starts without the `action_required` hold.
- Approve the held `pull_request` run from a controller (`release-approve` or fleetd), through the same API call the person used.

The first two change what GitHub sees and need no credential in the controller. The third spends a credential in fleetd and acts on a run the person did not read. The design step decides, and records the measured behaviour of each on the Actions API.

### Open Questions

- [ ] Why did fleetd not start a review of #2934's head? The cause decides whether the review slice is a fix or a new trigger.
- [ ] Which of the three CI mechanisms keeps `validate` required in the ruleset without widening `actions: write` beyond the `dispatch-ci` job?
- [ ] Does a status written by `dispatch-ci` satisfy the ruleset's required `validate`, or must the check come from the `ci.yml` job itself?
- [ ] Does the 2.29.1 run show the same `action_required` hold as 2.30.0, so the fix covers both?

## Slices

### Review

- `feature/the-release-head-is-reviewed` — fleetd reviews the release PR head so `plot/review` is `success` before `release-approve` runs

### CI

- `feature/the-release-head-reports-validate` — the release PR head reports `validate` to the PR without a person approving a run

## Notes

- Issue: https://github.com/plot-pm/plot/issues/3065. Refs #2907, #2934.
- Created unattended from the issue. Review channel `pr` and implementation `own branches` follow the repo's `Plan PRs: required`. The plan stays in Draft.
