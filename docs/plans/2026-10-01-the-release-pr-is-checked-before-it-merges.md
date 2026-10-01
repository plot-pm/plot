# The release PR is checked before it merges

> The release PR's required `validate` check has never reported. The `push` trigger written for it has never started a run, and every release merges with `--admin`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1040
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The release workflow starts CI on `changeset-release/main` each time it updates the release PR, so the PR's required `validate` check reports, and a release merges without `--admin`.

Board impact: none.

## Motivation

Measured 2026-10-01 through the Actions API (`repos/plot-pm/plot/actions/runs?branch=changeset-release/main`):

- **0 runs with `event=push`, ever.** The 100 most recent runs on the branch are all `pull_request`.
- **No `pull_request` run reports on its own.** The 20 most recent runs, all on 2026-10-01: 18 ended `action_required` and 2 ended `failure` (`5a9e8935`, `83df5e92`).
- **v2.22.0, v2.22.1 and v2.22.2 merged with `gh pr merge --admin`** on 2026-10-01, like every release before them.

`ci.yml:6-21` says a push-triggered run "reports without anyone approving it". It does not run at all. `changesets/action` (`release.yml:101-108`) pushes the branch with `secrets.GITHUB_TOKEN`, and GitHub does not start a workflow from an event that `GITHUB_TOKEN` caused, except `workflow_dispatch` and `repository_dispatch`. So the comment describes a run that never exists, and #1040's four `action_required` runs were `pull_request` runs, not push runs.

## Design

`ci.yml` gains `workflow_dispatch:` in its `on:` block and drops `changeset-release/main` from `push.branches`. The comment at `:6-21` is rewritten to state the measured fact above and the mechanism below.

`release.yml` gains one step after *Create Release PR or Publish*, with `if: steps.changesets.outputs.pullRequestNumber`: `gh workflow run ci.yml --ref changeset-release/main`. The job's `permissions` gain `actions: write`. A `workflow_dispatch` run reports its check runs on the branch head, so `validate` reports on the release PR's head commit under the same name the branch protection requires.

The *Check for changeset* step (`ci.yml:960-961`) already runs only on `pull_request`, so a dispatched run skips it, which is right: a release PR consumes changesets and adds none.

### What this does NOT do

- **It does not remove `validate` from the required checks.** The point is that it reports.
- **It does not approve the bot-authored `pull_request` runs.** They stay `action_required`; the dispatched run is the one that counts.

## Done when

- The next release PR after this merges shows a `validate` check from a `workflow_dispatch` run on its head commit, and merges with `gh pr merge` without `--admin`.
- `ci.yml` no longer lists `changeset-release/main` under `push`, and its comment states the measured mechanism.
- A new case in `test/reconcile/ci-scheme.test.mjs` reads `.github/workflows/ci.yml` and `release.yml` and asserts that `ci.yml` declares `workflow_dispatch`, that `push.branches` omits `changeset-release/main`, and that `release.yml` runs `gh workflow run ci.yml --ref changeset-release/main` under `actions: write`. It fails on `origin/main` today, where `ci.yml:21` lists the branch under `push` and `release.yml` has no dispatch step.
- If the dispatched run does not satisfy the required check on the PR, the slice records the measured reason in this plan and does not merge with a comment that claims it works.

## Slices

### The release workflow starts CI (Branch: infra/the-release-workflow-starts-ci)

The `workflow_dispatch` trigger, the dispatch step and its permission, the rewritten comment, and a changeset.

## Notes

**Open point: the verification needs a release PR.** A workflow change on `release.yml` is proven only when the release workflow next updates `changeset-release/main`. The slice's PR cannot show it; the first release PR after the merge does. Until then the Done-when's first item is open.

Split from #1088 on purpose: this plan is about the release PR's CI check, #1088 about who writes a lifecycle field. Its plan is `an-in-session-approval-has-a-controller`.
