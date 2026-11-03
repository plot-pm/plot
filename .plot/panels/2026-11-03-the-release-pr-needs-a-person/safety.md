# Safety juror: the-release-pr-needs-a-person

Plan: `docs/plans/2026-11-03-the-release-pr-needs-a-person.md` (plan PR #3070, issue #3065). Lens: what an unattended review and CI run on a bot-authored release PR may do wrong, and what refuses each.

Position: amend

## Summary

The plan names the right two gaps. It defers every safety decision to "the design step", and the plan holds no refusal, no provenance check and no test. Three of its premises need correction from measurements. One gap sits outside both slices: Plot's own merge rule reads a release PR as `green` when CI never reported, so today only GitHub's ruleset stops a release merge with no CI. An automated `validate` source makes that ruleset the single remaining guard, so the plan must close the Plot-side gap in the same change.

## Findings

### F1. Plot's merge rule reads "no CI" as green on a release PR (HIGH)

- `skills/plot/scripts/plot-host.sh:708-709` folds the rollup with `checks_of: colour_of(.statusCheckRollup // [])`, and that rollup includes the `plot/review` status. `ci_checks_of` excludes `plot/review`, but `pr-state` writes `checks:checks_of` (`plot-host.sh:4089`).
- `packages/domain/src/workflows/merge.ts:203` refuses only `pr.checks !== 'green'`. `release-approve.ts:143` calls `mergeAt` and adds no check of its own.
- On a release PR the held `pull_request` run creates no check runs (`ci.yml` header comment, and measured below), and the dispatched suite does not appear in the PR rollup. `gh pr view 2934 --json statusCheckRollup` today lists only the `pull_request` suite's checks plus `plot/review`. Before the person approved the held run at 14:47:32, the rollup held `plot/review: success` alone, which folds to `green`.
- So on 2026-11-03 `mergeAt` passed and GitHub's ruleset was the only refusal. In a repository without that ruleset, or after a person widens the ruleset bypass list, `release-approve` merges a release with no CI.
- `release-prepare.ts:179-187` (`requiredChecks`) already reads the required workflow's runs by head SHA through `runsForSha`. `releaseApprove` does not read it.

### F2. The dispatched run does report `validate` on the head SHA, but not in the PR rollup

Measured on head `14d28a09` (#2934): check suite `112877067409` (workflow_dispatch run `41655186640`) holds `validate: success`, completed 14:47:18, app `github-actions` (id 15368). Both suites report `pull_requests: []`. The ruleset `24412719` requires `validate` from integration 15368 and `plot/review` from integration 5317669.

On 2.29.1 (#2810, head `46a92390`) the dispatched `validate` succeeded at 12:57:38, and the person approved the held run at 13:08:40, 11 minutes later. That timeline suggests the ruleset does not count a check run from a suite with no PR association, but the API does not record the refused merge attempt, so this is evidence, not proof. The plan's sentence "reports no `validate` check to the PR" is true for the rollup and false for the commit. Open question 3 must be measured against the ruleset, not the rollup.

Open question 4 is answered: 2.29.1 shows the same hold (`pull_request` run `40874720456`, `triggering_actor` jwloka, started 13:08:40 after creation at 12:36:56). Every `pull_request` run on the branch since 10:01 on 2026-11-03 reads `action_required` until a person acts.

### F3. The dispatched run's own pin lives on the ref it tests

`ci.yml:112-127` and `:287-302` refuse a run whose `GITHUB_SHA` differs from `expected_sha`. That guard is read from `changeset-release/main`, which has no branch protection and no ruleset (`release.yml:129-131`). A writer who pushes a changed `ci.yml` to that branch between the force-push and the dispatch removes the guard from the run that tests their commit. Today a person still looks before the merge. Mechanism 1 (a status relayed from `dispatch-ci`) makes that run's conclusion the required check, so the relay must not trust the run's own guard.

### F4. Mechanism 1 as written needs a second permission and a run lookup the plan does not name

- `dispatch-ci` (`release.yml:160-180`) holds `actions: write` only and fires `gh workflow run`, which returns no run id. A relay must find its run, wait for it, and write the status. That needs `statuses: write` (or `checks: write`). Open question 2 names only `actions: write`.
- A status written at dispatch time, or written from the run's top-level conclusion without the `validate` job's conclusion, or written for a SHA read from the remote, reports green for something that was not tested.
- A commit status from `GITHUB_TOKEN` probably carries integration 15368, as `plot/review` from its App satisfies the ruleset as a status. If so, the relay's logic is the whole check for every release. The plan must state that and test it.

### F5. Mechanism 2 risks handing a ruleset-bypass token to the job that runs dependency code

- The ruleset bypass list holds `Integration 5173644` and `RepositoryRole 5` (admin). `build-bundles.yml:4-6` states that the `plot-build` App is in the bypass list. The only App credential the repository already holds is that one (`secrets.PLOT_BUILD_APP_ID`).
- The `release` job runs `pnpm install --frozen-lockfile` and, inside `changesets/action`, `pnpm run version` (`release.yml:69`, `:111-120`). The comment at `release.yml:46-49` keeps that job narrow on purpose.
- A token minted from the bypass App and placed in that job's environment lets any compromised dependency push to `main` past `validate` and `plot/review`. The plan does not exclude that choice.

### F6. Mechanism 3 approves code from an unprotected branch with the person's credential

- An approved same-repository `pull_request` run executes the workflow file from the PR's merge ref and has the repository secrets, `PLOT_BUILD_APP_PRIVATE_KEY` among them. Approval is the one place a person looks at the head before secrets meet it.
- fleetd's host calls run on the operator's `gh` token, which holds far more than `actions: write`. The plan says the third mechanism "acts on a run the person did not read" and leaves it as a candidate.
- A controller that calls `actions/runs/<id>/approve` directly also breaks `scripts/check-host-cli-callers.sh`; it must be a `plot-host.sh` op, and its Bitbucket arm must answer `unaskable`.

### F7. Nothing checks that the head is the release workflow's own output

`release-tick.ts:86-121` starts a review for whatever head the PR names once `requiredChecks` reads green and the scope is Delivered. The review slice makes that review unattended. Any writer can push to `changeset-release/main`; an unattended review plus a relayed or approved `validate` then leaves the person's `release-approve` as the only look at a commit nobody else read. The plan adds no refusal for a head that differs from what `release.yml` wrote, for example a head whose diff against `origin/main` touches `.github/`, `scripts/` or source files rather than the changeset version set (`CHANGELOG.md`, `package.json` versions, `.claude-plugin/*.json`, removed `.changeset/*.md`).

### F8. The order of review and CI is right today and the plan must keep it

`release-prepare.ts:256-260` starts the review only after the required workflow reads green on the head. The review agent therefore reads a tested head. The plan's review slice must not move the review ahead of CI to fix the 2026-11-03 gap, where the person reviewed at 14:38 before the dispatched run finished at 14:47.

### F9. No test plan

The plan names no test. For this lens each refusal below needs a test that fails before the change and passes after.

## Required amendments

1. **Close F1 in the plan.** `releaseApprove` refuses a new reason, for example `checks-missing`, when the required workflow (`Default branch checks`) has no success run on the pinned head, read through the same `runsForSha` reading `releaseStage` uses, or when `ciChecks` (rollup without `plot/review`) reads `none`. Test: a release PR whose rollup holds only `plot/review: success` and whose runs hold no CI success refuses `checks-missing`; today it passes `merge.ts:203`. Put it in a slice of its own or in the CI slice, and state which.
2. **Add a release-head provenance refusal** shared by every unattended path (the review start and whichever CI mechanism ships): the head's diff against `origin/main` touches only the changeset version set; anything else refuses by name, for example `release-head-foreign`, and the board shows it. The person decides the exact file set.
3. **If mechanism 1 ships,** the plan states: the relay job and its permission (`statuses: write` or `checks: write`, in its own job, no checkout, no install); how it finds its run (event `workflow_dispatch`, path `.github/workflows/ci.yml`, `head_sha` equal to `needs.release.outputs.head_sha`, actor `github-actions[bot]`) and the refusal when it finds zero or two; that it reads the `validate` job's conclusion, not the run's; that it writes only `success` or `failure` for that SHA and only after the run completes; and that a timeout fails the job with no status. Tests or a recorded measurement for each.
4. **If mechanism 2 ships,** the credential comes from an App that is not on the ruleset bypass list, holds only `contents` and `pull_requests` on this repository, and is never present in a step that runs `pnpm install`. The plan names the App and its permissions.
5. **If mechanism 3 ships,** the approval is a `plot-host.sh` op pinned to a run id whose `head_sha` equals the pinned head, event `pull_request`, head branch `changeset-release/main`; it runs only after amendment 2 passes; Bitbucket answers `unaskable`; each mismatch refuses by name. State whose token it spends.
6. **Correct the Motivation** with F2: the dispatched run creates `validate` on the head SHA and is absent from the PR rollup. Mark open question 4 as answered. Rewrite open question 3 to measure the ruleset's answer to a status and to a dispatched check run.
7. **Keep CI before review** (F8) as a stated constraint of the review slice, and add a test that the release review is not started while the required workflow reads `pending`.
8. **Add a test plan** covering amendments 1, 2, 3 or 4 or 5, and 7.

## Decisions that need a person

- Which CI mechanism ships, and with it which credential exists in CI or in fleetd. A credential and a permission change are not an agent's choice.
- Whether a relayed commit status may stand for the required `validate` check in the ruleset.
- Whether fleetd may approve a held Actions run at all.
- The file set that counts as "the release workflow's own output" (amendment 2).
- Any ruleset or branch-protection change, for example protecting `changeset-release/main` so only the release workflow can push it, which would remove F3 and F7 at the source.

An unattended Sonnet agent can build amendment 1, amendment 2 once its file set is given, and amendment 7. It cannot build the CI slice from this plan: the slice needs live release runs to measure, and its choice spends a credential.

## Ran versus read

Ran (read-only): `gh issue view 3065`; `gh pr view 2934` (head, author, rollup); `gh api` for runs, check runs and statuses on heads `14d28a09` and `46a92390`, check suites `112877021845` and `112877067409`, ruleset `24412719`, run `41655170108`, `/apps/github-actions`, `/apps/plot-review`; `gh run list -b changeset-release/main`; `git show`/`git grep` on `origin/main`.

Read only: `.github/workflows/release.yml`, `ci.yml`, `build-bundles.yml`; `packages/domain/src/workflows/release-approve.ts`, `merge.ts`; `packages/domain/src/rules/release-prepare.ts`; `packages/fleet/src/shared/release-tick.ts`; `skills/plot/scripts/plot-host.sh:690-710`. I did not read `plot-review.mjs` or `reviewPr`'s head re-ask in full; F8 and amendment 7 rely on `CLAUDE.md`'s statement that `reviewPr` re-asks the head before start and before write. I could not find the refused merge attempts in any API, so F2's ruleset conclusion is inferred from the approval timing.
