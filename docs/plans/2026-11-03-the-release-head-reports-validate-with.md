# The release head reports validate with no person approving a run

> The release PR carries a `validate` check that GitHub's ruleset counts on the pinned head, with no person approving a run.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #3073
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The release PR reports `validate` on its pinned head in what GitHub's ruleset counts, with no person approving a held run, through the mechanism the 2.30.1 measurement selects.

Board impact: the release row's stage reads #3070's `checks-missing` rule. Under Outcome A that rule also counts a `validate` check run from integration 15368 on the pinned head, so a head whose only `validate` is the dispatched run reads `ready` instead of `preparing`. Under Outcome B the row's reading is unchanged and the new `validate` reaches the rollup the rule already reads. The row's shape is unchanged in both outcomes.

## Motivation

The `pull_request` CI run that the changesets bot's release PR triggers waits as `action_required` until a person approves it. GitHub does not count the dispatched run's `validate` check run in the PR's rollup. On 2026-11-03, PR #2934 (release 2.30.0, head `14d28a09`) showed `validate` in the rollup only after a person approved the held run. Both check runs on that head came from integration 15368: the `workflow_dispatch` run 41655186640 at 14:47:18Z and the `pull_request` run 41655170108 (`run_attempt` 2, `triggering_actor` jwloka) at 14:59:56Z. Whether GitHub's ruleset counts the dispatched check run alone is unmeasured.

Ruleset `24412719` on `main`, read on 2026-11-03:

- `required_status_checks`: `validate` from integration 15368 (GitHub Actions) and `plot/review` from integration 5317669 (the review App), `strict_required_status_checks_policy: false`.
- `pull_request`: `required_approving_review_count: 0` and `require_extra_approval_for_unattributed_changes: true`.
- `bypass_actors`: RepositoryRole 5 (admin) and Integration 5173644 (`plot-build`), both `bypass_mode: always`. jwloka holds `admin`.

[The release PR needs a person for its review and its CI](2026-11-03-the-release-pr-needs-a-person.md) (issue #3065, plan #3070) builds Plot's own guard: `release-approve` refuses `checks-missing` when `validate` has no success in the PR's `statusCheckRollup` on the pinned head. Its Notes move the CI measurement and the CI mechanism to this plan. Release 2.30.1 is cut after #3070, so this plan starts on the 2.30.1 release head.

## Design

### Decisions

Taken by the person (jwloka) on 2026-11-03:

1. **The measurement reads and merges nothing.** On the 2.30.1 release head, before anyone approves the held `pull_request` run, jwloka records the readings in `### Measurement`. The release then proceeds as today: jwloka approves the held run once, and the sprint notes record that approval as an intervention.
2. **Two candidates for Outcome B.** A status relay from a new job, and a non-bypass token for the changesets action. The candidate "a controller approves the held run" is dropped: the held run uses `ci.yml` from the unprotected `changeset-release/main` with the repository secrets, including the `plot-build` App key (integration 5173644, a ruleset bypass actor). The mechanism for Outcome B stays open until the measurement.
3. **This plan owns Outcome A.** Its build slice widens #3070's `checks-missing` reading so it counts a `validate` check run from integration 15368 on the pinned head, not only the PR rollup.
4. **This plan takes over the tasks of #3070's removed CI slice:** the comment corrections at `.github/workflows/ci.yml:30-33` and `.github/workflows/release.yml:141-159`, the CI tests and the live proof.
5. **Order:** the measurement record first, as a person step recorded before approval. Then exactly one build slice, for the outcome measured. This plan stays Draft until the record exists.

### Scope

GitHub only. The changesets action, the `action_required` hold and ruleset `24412719` have no Bitbucket or Jenkins arm. Bitbucket and Jenkins are out of scope: a new host reading answers `unaskable` there, and `release-approve` keeps its current behaviour on those hosts.

Every candidate keeps these invariants: `validate` stays required with integration 15368, no new bypass actor, no ruleset change, and `strict_required_status_checks_policy` unchanged.

### Measurement

**Owner:** jwloka. **When:** on the 2.30.1 release head, after the dispatched run's `validate` reads `success` and `plot/review` exists on the head, and before anyone approves the held `pull_request` run. **Where:** the `Record:` list below, in a commit to this plan on `idea/the-release-head-reports-validate-with` (plan PR #3076).

`plot-ask.mjs release-approve` is not part of the measurement. After #3070's checks slice, it refuses `checks-missing` on this head before it calls GitHub. That answer is expected and the record notes it.

Reading 1, before any approval (`<n>` is the release PR, `<sha>` its head):

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
gh api user --jq .login
gh pr view <n> --repo plot-pm/plot --json mergeStateStatus,statusCheckRollup,headRefOid
gh api repos/plot-pm/plot/commits/<sha>/check-runs \
  --jq '.check_runs[] | {name, app: .app.id, conclusion, check_suite: .check_suite.id, completed_at}'
gh api repos/plot-pm/plot/commits/<sha>/statuses \
  --jq '.[] | {context, state, creator: .creator.login, created_at}'
gh api "repos/plot-pm/plot/actions/runs?head_sha=<sha>" \
  --jq '.workflow_runs[] | {id, name, event, status, conclusion, run_attempt, triggering_actor: .triggering_actor.login}'
gh api repos/plot-pm/plot/rulesets/24412719 \
  --jq '.rules[] | select(.type == "pull_request") | .parameters.require_extra_approval_for_unattributed_changes'
```

Then jwloka approves the held run once, as in a release today.

Reading 2, after the approved run's `validate` reads `success` and before the merge: the same `date`, `gh pr view` and `actions/runs` commands. This reading tells a `validate` block from a block by another rule.

### Outcomes

- **Outcome A, GitHub counts the dispatched `validate`.** Reading 1 shows `mergeStateStatus` not `BLOCKED`, `headRefOid` equal to `<sha>`, the dispatched `validate` check run from app 15368 with conclusion `success`, and no `pull_request` run with `run_attempt` above 1.
- **Outcome B, GitHub does not count it.** Reading 1 shows `BLOCKED` with the same head and the dispatched `validate` `success`, and reading 2 shows `BLOCKED` gone once the approved run's `validate` succeeded.
- **Inconclusive.** The head moved between readings, the dispatched run had not finished at reading 1, or another rule blocks: reading 2 still shows `BLOCKED` after the approved run's `validate` succeeded. `require_extra_approval_for_unattributed_changes: true` is a possible blocker to read here, because `github-actions[bot]` pushes the release commit with `GITHUB_TOKEN` (`release.yml:111-120`). An inconclusive record chooses no mechanism. jwloka measures again on the next release head.

Record:

- [ ] not yet run

### Candidate mechanisms

For Outcome B only. The choice goes into `### Decisions` after the record exists.

| Candidate | File and job | Credential | Permission change | Cost |
|---|---|---|---|---|
| (a) Status relay | A new job, never `dispatch-ci`, which exits without waiting (`release.yml:160-180`). Either a final job in `.github/workflows/ci.yml` on the `workflow_dispatch` event, or a new workflow on `workflow_run` of `CI`. | `GITHUB_TOKEN`, so the status carries integration 15368. Never `Host.commitStatus`, which writes as the review App (5317669). | `statuses: write` on that one job. This conflicts with `ci.yml:50` (`permissions: contents: read`, "neither writes anything back"), and the comment changes with it. | The relay's logic becomes the whole required check. A final `ci.yml` job runs the file from the unprotected `changeset-release/main`; a `workflow_run` workflow runs its file from `main`. One extra job per release head. |
| (b) Non-bypass token | `.github/workflows/release.yml`: the `release` job splits, so the new token never reaches the step that runs `pnpm install` and `pnpm run version`. | A new GitHub App or token that is not a ruleset bypass actor. Never `plot-build` (5173644) or any other bypass actor. | A new secret, and a new job holding it. `release.yml:46-49` records the decision that keeps the `release` job narrow; the split keeps it narrow. | A new App and secret, and a job split in the publishing workflow. Whether GitHub holds a `pull_request` run on an App-authored PR is unmeasured, so this candidate needs its own reading before it is chosen. |

Constraints on (a): no checkout and no install. The job finds the dispatched run by event `workflow_dispatch`, path `.github/workflows/ci.yml`, `head_sha` equal to the pinned SHA and actor `github-actions[bot]`. Zero or two matches fail the job. It writes `validate` only for the pinned SHA, compares that SHA itself, and does not trust the run's own pin (`ci.yml:112-127` lives on the unprotected branch). It copies the run's own result, `success` or `failure`, only after the run completes. A timeout fails the job with no status. A cancelled run is not a result: the `release-dispatch` concurrency group cancels a superseded dispatched run, and the relay writes nothing for it.

Constraints on (b): every new `uses:` is SHA-pinned. The new token pushes the branch as well as opening the PR, so every regenerated head starts a `synchronize` run; a `GITHUB_TOKEN` push starts none (`ci.yml:20-27`).

### Candidate slices

Exactly one of these moves to `## Slices` once the record holds Outcome A or Outcome B.

- Outcome A: `feature/the-release-checks-count-the-dispatched-run` — #3070's `checks-missing` rule counts a `validate` check run from integration 15368 on the pinned head as well as the PR rollup; `releaseApprove` and `releaseStage` read the one rule; a GitHub host read of the head's check runs by name and app id, `unaskable` on Bitbucket and Jenkins; the comment corrections in `### Docs and comments`
- Outcome B: `feature/the-release-head-gets-validate` — the mechanism chosen from `### Candidate mechanisms`, under its constraints; the comment corrections in `### Docs and comments`

The Outcome A slice reads what GitHub counts and nothing more: context `validate`, app 15368, the pinned head. A new `plot-host.sh` read pays the shell-lines ratchet (`scripts/check-shell-lines.sh`), and the slice states the lines it removes.

### Tests

Each test fails before its slice's change and passes after, unless marked as a guard.

The Outcome A slice:

- `packages/domain/test/workflows-release-approve.test.ts`: "a head whose only validate is a dispatched check run passes the checks rule" (from #3070). Today it refuses `checks-missing`.
- The same file, guard: "a validate check run from another app does not pass the checks rule".
- The same file, guard: "a validate check run on another SHA does not pass the checks rule".
- `packages/domain/test/release-prepare.test.ts`: "a head whose only validate is a dispatched check run reads ready". Today it reads `preparing`.
- `test/reconcile/host.test.mjs`, if `plot-host.sh` gains the read: "the head's check runs are reported by name and app id", with a Bitbucket case that answers `unaskable`.

The Outcome B slice: no local suite reads the ruleset or runs a workflow. For (a), a contract test under `test/reconcile/` asserts that the relay job holds `statuses: write` and no other write, has no checkout and no install, and pins every `uses:` by SHA. For (b), a contract test asserts that no job that runs `pnpm install` holds the new secret. Each candidate also needs the recorded live proof below. A red dispatched `validate` cannot be produced on a release head on purpose, so the relay's failure path stays unproved live, and the slice states this.

### Docs and comments

- `.github/workflows/ci.yml:30-33` says the dispatched run's `validate` is "the context the branch protection requires, so the required check reports". The rollup did not show it on 2.30.0. The build slice corrects it with the measured outcome.
- `.github/workflows/release.yml:141-159`, the `dispatch-ci` header comment, states the same belief. The build slice corrects it.
- Under (a), the `ci.yml:47-51` permissions comment changes with the new `statuses: write`.

### Live proof

The person (jwloka) watches the first release head after the build slice merges and records in this plan, from the Actions, checks and rulesets APIs:

- `validate` from integration 15368 exists on the pinned head in what GitHub counts before the `release-approve` call;
- every workflow run on the head has a `triggering_actor` that is not a person, and no `pull_request` run has a person-started `run_attempt` above 1;
- the merge's rule-suite (`gh api "repos/plot-pm/plot/rulesets/rule-suites?ref=refs/heads/main"`) reads `result: pass`, not `bypass`;
- the `release-approve` receipt is the only person action between the head's force-push and the merge.

This plan is delivered only after this record exists. It also closes #3070's line "The CI slice is delivered only after this record exists".

### Open Questions

- [ ] What does the 2.30.1 measurement record? Answered by `### Measurement`; this plan stays Draft until the record exists.
- [ ] Under Outcome B, which candidate does the person choose: (a) the relay or (b) the non-bypass token?
- [ ] Does `mergeStateStatus` read `BLOCKED` for a viewer with bypass `always`? The record names the reading identity, and reading 2 checks the answer against the approved run.

## Slices

## Notes

- Source: issue #3073. Refs #3065 and #3070.
- `## Slices` is filled after the measurement, with the one candidate slice the record selects. The plan parser reads a Draft with no slice, so the section stays empty until then.
- Panel round 1: `.plot/panels/2026-11-03-the-release-head-reports-validate-with/panel.md`.
