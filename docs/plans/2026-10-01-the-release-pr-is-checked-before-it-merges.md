# The release PR is checked before it merges

> The release PR's required `validate` check has never reported. The `push` trigger written for it has never started a run, and every release merges with `--admin`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1040
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The release workflow starts CI on `changeset-release/main` each time it updates the release PR, so the PR's required `validate` check reports, and a release merges without `--admin`.

Board impact: none.

## Motivation

Measured 2026-10-01 through the Actions API (`repos/plot-pm/plot/actions/runs?branch=changeset-release/main`):

- **0 runs with `event=push`, ever.** The 100 most recent runs on the branch are all `pull_request`.
- **No `pull_request` run reports on its own.** Of the 20 most recent runs, all on 2026-10-01, 18 ended `action_required`. The other 2 ended `failure` with 0 jobs on the heads of PRs that had already merged (`5a9e8935`, `83df5e92`), so they are not CI failures.
- **v2.22.0, v2.22.1 and v2.22.2 merged with `gh pr merge --admin`** on 2026-10-01, like every release before them.

`ci.yml:6-21` says a push-triggered run "reports without anyone approving it". It does not run at all. `changesets/action` (`release.yml:101-108`) pushes the branch with `secrets.GITHUB_TOKEN`, and GitHub does not start a workflow from an event that `GITHUB_TOKEN` caused, except `workflow_dispatch` and `repository_dispatch`. So the comment describes a run that never exists, and #1040's four `action_required` runs were `pull_request` runs, not push runs.

## Design

### `ci.yml`

- `on:` gains `workflow_dispatch:` with one required input, `expected_sha`. `push.branches` drops `changeset-release/main` and keeps `main`. The comment at `:6-21` is rewritten to state the measured fact above and the mechanism below.
- A top-level `permissions: contents: read` is added. The file has none today, so every run inherits the repository default (`read` today), and a settings change would widen runs on a bot-written ref.
- A top-level `concurrency:` block: `group: ci-${{ github.event_name == 'workflow_dispatch' && 'release-dispatch' || github.run_id }}`, `cancel-in-progress: true`. Every dispatched run shares one group, so a regeneration cancels the superseded release run. Every other run gets its own group, so a `main` push run or a pull request run is never cancelled. Measured 2026-10-01: the branch regenerated five times between 22:23 and 22:39, and each regeneration starts a `validate` with a 25-minute ceiling.
- Every job's first step is a guard that runs only on `workflow_dispatch`. It fails when `github.ref` is not `refs/heads/changeset-release/main`, and it fails when `github.sha` differs from `inputs.expected_sha`. The first refusal keeps a dispatch on any other branch from reporting a `validate` that tested a head and never a merge ref. The second closes the window between the changesets force-push and the dispatch: `changeset-release/main` has no branch protection and no ruleset (404 on 2026-10-01), so any writer can push in that window, and an unpinned run would report green on their commit.
- *Check for changeset* (`ci.yml:960-961`) runs only on `pull_request`, so a dispatched run skips it, which is right: a release PR consumes changesets and adds none.

### `release.yml`

- The `release` job's `permissions` do not change. It keeps `contents: write`, `pull-requests: write` and `id-token: write`, and it runs `changesets/action`, `pnpm install` and `create-release.sh`, so `actions: write` does not go there.
- After *Create Release PR or Publish*, the `release` job reads the head SHA from the local `changeset-release/main` ref that `changesets/action` committed and pushed, and exposes it and `pullRequestNumber` as job outputs. If that local ref is absent, the step fails; it never reads the remote, because the remote is the ref the guard distrusts.
- A new job, `dispatch-ci`, `needs: release`, `if: needs.release.outputs.pr_number`, with `permissions: actions: write` and nothing else. It has no checkout and no `uses:` step. It runs `gh workflow run ci.yml --repo "$GITHUB_REPOSITORY" --ref changeset-release/main -f expected_sha="$HEAD_SHA"` with `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, and prints the dispatched SHA and PR number before the call. `gh` is preinstalled on the runner, so no action is added, and every existing `uses:` stays SHA-pinned.
- A failed `gh workflow run` fails `dispatch-ci`, and so the release workflow run. It is the only signal that the release PR carries no check, so it is not a warning.

### Which `validate` the PR shows

A dispatched run creates its check runs on the head SHA under the job name `validate`, from app 15368, which is the context the branch protection requires. The bot-authored `pull_request` runs stay `action_required` and create no check runs: head `3141b813` carries 0. So nothing shadows the dispatched result.

### The per-run approval goes away

Today a person can approve each held `pull_request` run, and nobody does: every release merges with `--admin`, which skips the check entirely. After this change no person approves the CI run. That is acceptable because the run is pinned to the SHA the release workflow itself wrote and to the one release branch, the token that starts it can write nothing but Actions, and the merge stays a human act. A green `validate` replaces an `--admin` that checked nothing.

### The release step

`RELEASING.md` gains the step under *On push to `main`*, because `/plot-release` step 4 hands off to the project's release process and merges nothing. The step: wait for `validate` on the release PR's current head, then merge with `gh pr merge` and no `--admin`. On red, fix the cause, or re-run with `gh workflow run ci.yml --ref changeset-release/main -f expected_sha=<head>`. `--admin` stays a named exception, and each use is recorded in the release PR with its reason. A push to `main` while waiting regenerates the branch, and the wait starts again on the new head.

### Fallback if the dispatched run is also held

Nobody has measured whether GitHub holds a `workflow_dispatch` run started by `github-actions[bot]`. If it does, the fallback is to gate the tag: `create-release.sh` refuses to tag and publish unless a green `validate` exists for the release PR's head. A GitHub App token is the other option and is not chosen, because it adds a stored credential with write scope to a job that already publishes to npm. The fallback is its own plan, opened from #1040.

### What this does NOT do

- **It does not remove `validate` from the required checks.** The point is that it reports.
- **It does not approve the bot-authored `pull_request` runs.** They stay `action_required`; the dispatched run is the one that counts.
- **It does not change `/plot-release`.** Its step 4 merges nothing.

## Done when

- `ci.yml` declares `workflow_dispatch` with an `expected_sha` input, no longer lists `changeset-release/main` under `push`, carries top-level `permissions: contents: read` and the `concurrency:` block above, and its comment states the measured mechanism.
- Every job in `ci.yml` starts with the guard, which fails a dispatched run on any ref other than `refs/heads/changeset-release/main` or on a `github.sha` that differs from `inputs.expected_sha`.
- `release.yml` has a `dispatch-ci` job with `needs: release`, `permissions: actions: write` only, no checkout, `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, a printed SHA, and `gh workflow run ci.yml --ref changeset-release/main -f expected_sha=...`. The `release` job's permissions are unchanged.
- Every `uses:` in both files stays pinned to a full SHA, and no new action is added.
- A new file, `test/reconcile/release-pr-ci.test.mjs`, reads both workflow files with `fs.readFileSync` as text, the way `test/reconcile/artifact.test.mjs:249` reads `ci.yml`, and asserts each item above by matching lines inside the named job or block. No YAML parser is added: the repository has none as a dependency. The test fails on `origin/main` today, where `ci.yml:21` lists the branch under `push` and `release.yml` has no dispatch job.
- `RELEASING.md` states the release step above.
- **After the merge:** the first release PR shows a `validate` from a `workflow_dispatch` run on its head commit and merges with `gh pr merge` without `--admin`. If it shows no `validate`, or one held at `action_required`, the measured run state is recorded in this plan and #1040 is reopened.

## Slices

### The release workflow starts CI (Branch: infra/the-release-workflow-starts-ci)

The `workflow_dispatch` trigger with its SHA and ref guard, the `concurrency:` group and top-level permission in `ci.yml`, the `dispatch-ci` job, the rewritten comment, `release-pr-ci.test.mjs`, the `RELEASING.md` step, and a changeset.

## Notes

**Open point: the verification needs a release PR.** A workflow change on `release.yml` is proven only when the release workflow next updates `changeset-release/main`. The slice's PR cannot show it; the first release PR after the merge does. Until then the Done-when's last item is open.

**Round 1 (2026-10-02):** three jurors, unanimous `amend`. The amendment moves the dispatch into its own job with `actions: write` only, pins the run to the expected head SHA and to the release branch, adds `permissions: contents: read` and a `concurrency:` group to `ci.yml`, names the test file and the release step, picks gating the tag as the fallback, and moves the proof to after the merge. Moderation: `.plot/panels/2026-10-01-the-release-pr-is-checked-before-it-merges/round1.md`.

Split from #1088 on purpose: this plan is about the release PR's CI check, #1088 about who writes a lifecycle field. Its plan is `an-in-session-approval-has-a-controller`.
