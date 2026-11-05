# The release PR needs a person for its review and its CI

> The release PR carries a passing `validate` check and a `plot/review` status on its head without a person, so `release-approve` is the only step a person takes.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3065
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3070 merged
- **Started:** 2026-11-03, Jan Wloka, `feature/the-release-review-is-switched-on`
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- fleetd reviews the release PR's head in this repository: `Auto-review: true` is set in `## Plot Config`, and a release review that the switch skips is logged as skipped.
- `plot-ask.mjs release-approve` refuses `checks-missing` when the required `validate` check has no success on the pinned head in what GitHub counts, and the board's release stage reads the same rule, so it never shows `ready` while the merge refuses.
- `plot-ask.mjs release-approve` refuses `release-head-foreign` when the release head changes more than the changesets version step writes.

Board impact: the release row changes. Its stage reads the new checks rule, so a head whose `validate` GitHub does not count reads `preparing`, not `ready`, and a foreign head shows the hold `release-head-foreign`. The row's shape is unchanged.

## Motivation

On 2026-11-03 `plot-ask.mjs release-approve 2934 <sha>` did not merge release PR #2934 on the first two attempts (issue #3065):

1. `review-missing`: no `plot/review` existed on the head, so a person ran `plot-review.mjs 2934`.
2. GitHub refused the merge with "the base branch policy prohibits the merge" at about 14:39Z. Ruleset `24412719` on `main` requires `validate` (integration 15368, GitHub Actions) and `plot/review` (integration 5317669). A person then approved the held `pull_request` run with `gh api -X POST repos/plot-pm/plot/actions/runs/<id>/approve`.

The measurement on record from that release (2.30.0, head `14d28a09`):

- `release-approve` passed Plot's own checks while the PR's `statusCheckRollup` held only `plot/review: success`. The held `pull_request` run reported nothing, and the rollup folds `plot/review` alone to `green` (`plot-host.sh:709`, `merge.ts:203`).
- The dispatched `workflow_dispatch` run did write a `validate` check run on the head: check suite `112877067409`, `success` at 14:47:21Z. That check run is absent from the PR rollup; both check suites on the head report `pull_requests: []`.
- GitHub's refusal at about 14:39Z came while the dispatched run was still in progress.
- After the dispatched run finished, the rollup still showed only `plot/review`. `validate` appeared in the rollup only after the person approved the held run at 14:47:31Z.
- No merge was attempted between 14:47:21Z and 14:47:31Z. Whether the ruleset accepts the dispatched check alone is therefore unmeasured.

The same hold occurred on the two releases before. 2.29.1 (#2810, head `46a92390`): the dispatched `validate` succeeded at 12:57:38Z, `plot-ask.mjs merge` refused `checks-not-green` (rollup `none`) at 13:08:09Z, and a person approved the held run at 13:08:40Z. 2.29.0 (#2452, head `d7c65b08`): dispatched `validate` green at 04:58:56Z, approval at 05:45:38Z. Three of the last three releases needed a person for work that is not the release decision.

The review gap has a measured cause. `registryd-main.ts:3070` passes `readAutoReview(boardOpts).autoReview` to the release arm, and `release-tick.ts:118` starts the release review only `if (step.step === 'review' && reviewEnabled)`. `auto-review.ts:55-57` reads an absent `Auto-review` key as off, and this repository's `## Plot Config` has no such key. fleetd's log holds 35 to 53 `release preparing: review` lines across this machine's log files, and no review started; the skipped branch writes no run-log line.

[The release waits for one approval](2026-10-29-the-release-waits-for-one-approval.md) set the goal that `release-approve` is the one step a person takes. Its line 41 named Plot's own fold as a cause of the refusal, and its line 70 decided that the rule reads the ruleset's required checks by name and that the slice first measures whether a green dispatched `validate` alone lets the release PR merge. Delivery recorded no such measurement. [The release PR is checked before it merges](2026-10-01-the-release-pr-is-checked-before-it-merges.md) added the `dispatch-ci` job in `.github/workflows/release.yml`. This plan closes both gaps.

## Design

### Decisions

Taken by the person (jwloka) on 2026-11-03:

1. **`Auto-review: true` in this repository's `## Plot Config`.** It starts the release review and also turns on fleetd's review of every slice PR, which the sprint goal needs. The `release preparing: review` log line names a skipped review as skipped, with a run-log outcome and a test.
2. **Measure first for CI.** Plot's own guard is built here. The measurement and the CI mechanism are plan #3076 (issue #3073), which starts after release 2.30.1; the controller-approves-the-held-run option is dropped there.
3. **Provenance check.** `release-approve` refuses `release-head-foreign` when the head changes more than the changesets version step writes. No branch protection or ruleset change.

### Scope

GitHub only. The changesets action, the `action_required` hold and the ruleset have no Bitbucket or Jenkins arm. A Bitbucket repository's release PR gets no change: the new readings answer `unaskable` there, and `release-approve` keeps its current behaviour on that host.

### Approach

**Review switched on.** The config line plus `./scripts/check-agents-md.sh --write` is the first slice. In the same slice `releaseTick` returns a named outcome when the switch skips a `review` step, appends a `release-review` run-log line with outcome `skipped: auto-review-off`, and the fleetd line reads `plot-fleetd: release preparing: review skipped (Auto-review off)` instead of `release preparing: review`.

The review waits on CI. `release-prepare.ts:256-260` returns `none('checks-…')` before the review question while the required workflow is not green on the head. That order stays: the review agent reads a tested head. So the review slice works live only on a head whose `CI` run already succeeded, and its live check names such a head.

**Two check questions, two readings.** The domain answers two different questions about the head, and each caller reads the one it needs:

- *Was the head tested?* Any `CI` run on the head succeeded (`requiredChecks`, `release-prepare.ts:179-187`, through `Build.runsForSha`). The release review start keeps this reading; the dispatched run's conclusion is a real test result.
- *Will the merge count the check?* The required `validate` check has a success on the pinned head in what GitHub counts. Until the measurement says otherwise, "what GitHub counts" is the PR's `statusCheckRollup` on the head, excluding `plot/review`. `releaseApprove` refuses `checks-missing` on this reading before it calls `mergeAt`, and `releaseStage` answers `ready` only when it passes. One domain rule serves both, so the board and the merge cannot disagree.

**Provenance.** A domain rule reads the head's changed files and lines against `origin/main`, from their merge base (`origin/main...<head>`: a two-dot diff would list main's newer commits as the head's changes). The head passes only when every change is in the version step's set, verified against release commits `14d28a097` (2.30.0) and `fbe76191e` (2.29.x):

| Path | Allowed change |
|---|---|
| `.changeset/*.md` | deletion only (`config.json`, `README.md`, `changelog-functions.js` and `_template` stay untouched) |
| `CHANGELOG.md`, `packages/*/CHANGELOG.md` | any |
| `package.json`, `packages/*/package.json` | the `"version"` line only |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | the `"version"` line only |
| `skills/*/SKILL.md` | the frontmatter `metadata.version` line only |

Anything else refuses `release-head-foreign`, naming the first foreign path. The same rule holds the release review start, so fleetd starts no unattended review on a foreign head, and the board's release stage shows the hold.

**CI.** The measurement on the 2.30.1 release head and the mechanism it selects are plan #3076 (issue #3073). This plan builds only Plot's own guard (`checks-missing`, `release-head-foreign`) and the review switch.

### Open Questions

- [x] Why did fleetd not start a review of #2934's head? `Auto-review` is absent from this repository's config (Decision 1).
- [x] Does the 2.29.1 run show the same `action_required` hold as 2.30.0? Yes: `pull_request` run `40874720456` was held until 13:08:40Z, and 2.29.0 shows the same hold.
- [x] Does the ruleset accept a green dispatched `validate` alone? Moved to plan #3076 (issue #3073), which measures it on the 2.30.1 release head.
- [ ] Where do the required check names come from: the ruleset's required status checks read through `plot-host.sh` on GitHub, or a config key? The guard slice decides and states it; a ruleset read is a new connector op and pays the shell-lines ratchet.

### Tests

Each test fails before its slice's change and passes after, unless marked as a guard.

The review slice:

- `packages/fleet/test/unit/release-tick.test.ts`: "a review step with Auto-review off writes a release-review line with outcome skipped: auto-review-off". Today the skipped branch writes nothing.
- The same file: "a skipped release review names itself skipped in the fleetd line". Today the line reads `release preparing: review`.

The checks slice:

- `packages/domain/test/workflows-release-approve.test.ts`: "a release PR whose rollup holds only plot/review success refuses checks-missing". Today it passes `merge.ts:203`.
- The same file: "a release PR whose required validate succeeded on the pinned head passes the checks rule" (control).
- `packages/domain/test/release-prepare.test.ts`: "a head whose only CI success is outside what GitHub counts reads preparing, not ready". Today it reads `ready`.
- The same file, guard: "the release review is not started while the required workflow reads pending".
- The same file, guard: "the release review starts on a head whose dispatched CI run succeeded".
- `test/reconcile/host.test.mjs`, if `pr-state` gains the rollup's CI checks: "pr-state reports the rollup's checks without plot/review", with a Bitbucket case that keeps its current answer.

The provenance slice:

- `packages/domain/test/workflows-release-approve.test.ts`: "a head that changes .github/workflows/ci.yml refuses release-head-foreign"; "a head that changes a SKILL.md body line refuses release-head-foreign"; "a head that changes a package.json dependency refuses release-head-foreign". Today all three pass.
- The same file, control: "a head holding only the version step's changes passes".
- `packages/domain/test/release-prepare.test.ts`: "a foreign release head holds the review start and the stage". Today the review starts.

The CI mechanism's tests, including "a head whose only validate is a dispatched check run passes the checks rule", are plan #3076's.

### Docs and comments

- `.github/workflows/ci.yml:30-33` and `.github/workflows/release.yml:141-159` (the `dispatch-ci` header comment) state that the dispatched run makes the required check report. Plan #3076 corrects both with the measured outcome.
- `AGENTS.md` follows the `CLAUDE.md` config change through `./scripts/check-agents-md.sh --write`.

### Live proof

The person (jwloka) watches the first release after delivery and records in this plan, from the Actions and statuses APIs:

- the run log carries a `release-review` line with outcome `moved` for that head;
- the `release-approve` receipt is the only person action between the head's force-push and the merge.

On the 2.30.1 release a person still approves the held CI run once; that approval is recorded as an intervention in the sprint notes and does not fail this proof. Plan #3076's live proof covers the CI run.

## Slices

### Review switched on

- `feature/the-release-review-is-switched-on` — set `Auto-review: true`, regenerate `AGENTS.md`, and log a skipped release review as skipped <!-- waits: bug/a-high-gets-its-own-fixer-attempts --> → #3175

### Release guard

- `feature/the-release-checks-are-counted` — `release-approve` refuses `checks-missing` and the release stage reads the same rule
- `feature/the-release-head-is-the-version-step` — `release-approve` refuses `release-head-foreign` and fleetd starts no review on a foreign head

## Notes

- Issue: https://github.com/plot-pm/plot/issues/3065. Refs #2907, #2934, #2810.
- Created unattended from the issue. Review channel `pr` and implementation `own branches` follow the repo's `Plan PRs: required`. The plan stays in Draft.
- Panel round 1: `.plot/panels/2026-11-03-the-release-pr-needs-a-person/panel.md`.
- The CI mechanism is not a slice of this plan (decided 2026-11-03). Its measurement needs a live release head, and release 2.30.1 cannot be cut while this plan is unfinished, so a CI slice here would hold the release it needs. The measurement and the mechanism move to #3073, planned as plan PR #3076.
