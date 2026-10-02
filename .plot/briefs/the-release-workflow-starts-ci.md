## Implementation brief — the-release-pr-is-checked-before-it-merges

- **Plan (canonical):** docs/plans/2026-10-01-the-release-pr-is-checked-before-it-merges.md on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `infra/the-release-workflow-starts-ci` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** the repository's normal PR review; CI is the authority on the suites

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

The release PR's required `validate` check has never reported. `release.yml` pushes `changeset-release/main` with `secrets.GITHUB_TOKEN`, and GitHub starts no workflow from an event that token caused, except `workflow_dispatch` and `repository_dispatch`. Measured 2026-10-01 through the Actions API: 0 runs with `event=push` on that branch, ever; 18 of the 20 most recent `pull_request` runs ended `action_required`; v2.22.0, v2.22.1 and v2.22.2 all merged with `gh pr merge --admin`.

So the release workflow dispatches CI itself. `ci.yml` gains a `workflow_dispatch` trigger with an `expected_sha` input and a guard step. `release.yml` gains a `dispatch-ci` job that runs `gh workflow run ci.yml --ref changeset-release/main -f expected_sha=<head>` after `changesets/action` has updated the branch. The dispatched run creates its check runs under the job name `validate`, which is the context branch protection requires. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**A `push` trigger on the release branch cannot work, and the comment saying it does is wrong.** `ci.yml:6-21` claims a push-triggered run "reports without anyone approving it". The run never exists. Drop `changeset-release/main` from `push.branches` (keep `main`) and rewrite the comment to state the measured mechanism above. Do not keep the branch listed "in case".

**The dispatch is its own job, and `actions: write` goes only there.** The `release` job runs `changesets/action`, `pnpm install` and `create-release.sh` with `contents: write` and `id-token: write`; widening it with `actions: write` was the rejected alternative. `dispatch-ci` has `needs: release`, `if: needs.release.outputs.pr_number`, `permissions: actions: write` and nothing else, no checkout and no `uses:` step. `gh` is preinstalled on the runner, so no action is added and every existing `uses:` stays pinned to a full SHA. The `release` job's own `permissions` do not change.

**The head SHA comes from the LOCAL `changeset-release/main` ref**, which `changesets/action` committed and pushed. Expose it, and `pullRequestNumber`, as `release` job outputs. If the local ref is absent, the step fails. It never reads the remote, because the remote is the ref the guard distrusts: `changeset-release/main` has no branch protection and no ruleset (404 on 2026-10-01), so any writer can push between the force-push and the dispatch.

**The guard is the first step of EVERY job in `ci.yml`, and `ci.yml` has two: `corpus` and `validate`.** It runs only on `workflow_dispatch`. It fails when `github.ref` is not `refs/heads/changeset-release/main` (otherwise a dispatch on any branch reports a `validate` for a head, never a merge ref), and it fails when `github.sha` differs from `inputs.expected_sha` (otherwise an unpinned run reports green on whoever pushed in the window). A guard on `validate` alone passes the plan's "every job" item only by accident of `corpus` being skipped; put it in both.

**`concurrency:` at the top of `ci.yml`:** `group: ci-${{ github.event_name == 'workflow_dispatch' && 'release-dispatch' || github.run_id }}`, `cancel-in-progress: true`. Every dispatched run shares one group, so a regeneration cancels the superseded release run. Every other run gets its own group, so a `main` push run or a pull request run is never cancelled. A group keyed on the ref would cancel pull request runs; do not use one. Measured 2026-10-01: the branch regenerated five times in 16 minutes and each started a `validate` with a 25-minute ceiling.

**Top-level `permissions: contents: read` in `ci.yml`.** The file has none, so runs inherit the repository default. Check no job needs more before adding it; the plan's measurement is that none does.

**A failed `gh workflow run` fails `dispatch-ci` and so the release run.** It is the only signal that the release PR carries no check. Do not add `continue-on-error` or `|| true`.

**Both token and fallback are settled.** `secrets.GITHUB_TOKEN` with `actions: write`; a GitHub App token was rejected because it adds a stored write credential to a job that publishes to npm. Nobody has measured whether GitHub holds a `workflow_dispatch` run started by `github-actions[bot]`. If it does, the fallback is gating the tag in `create-release.sh`, and that is its own plan from #1040. Do not build it here.

**Not in this slice:** removing `validate` from the required checks; approving the bot-authored `pull_request` runs (they stay `action_required`); any change to `/plot-release`, whose step 4 merges nothing.

**Rules carried over from related work:** a gate that cannot be asked fails, it never passes (the guard fails on an empty `inputs.expected_sha`, it does not skip); a check proves nothing until the test fails on `origin/main` today.

**Drift in the plan's line numbers.** `ci.yml`'s *Check for changeset* step now sits at `:1150`, not `:960-961`. It runs only on `pull_request`, so a dispatched run still skips it. Locate by name.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation would pass without them:

- **The guard is checked in each job by name, `corpus` and `validate`.** A test that finds one guard anywhere in the file passes with `corpus` unguarded.
- **`release.yml` permissions are asserted inside the `release` job block and the `dispatch-ci` block separately.** A whole-file match for `actions: write` passes with the permission on the wrong job.
- **`release-pr-ci.test.mjs` fails on `origin/main` today.** Run it before the change and record that it fails; `ci.yml:21` lists the branch under `push` and `release.yml` has no dispatch job. Read both files with `fs.readFileSync` as text, as `test/reconcile/artifact.test.mjs:249` reads `ci.yml`. Add no YAML parser: the repository has none as a dependency.
- **Every `uses:` in both files is still a 40-hex SHA**, and the set of actions did not grow.
- **No `concurrency` group contains `github.ref`.**

Plus: `RELEASING.md` states the release step under *On push to `main`* (wait for `validate` on the release PR's current head, then `gh pr merge` with no `--admin`; on red fix the cause or re-run with `gh workflow run ci.yml --ref changeset-release/main -f expected_sha=<head>`; `--admin` stays a named exception recorded in the release PR with its reason; a push to `main` while waiting regenerates the branch and the wait restarts). Add a changeset in `.changeset/` with `'plot': patch`, the description first and the `plan:` and `bumps:` comment block last; no skill changes, so `bumps:` may be omitted. Run `./scripts/check-changeset-packages.sh`. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite.

The plan's last Done-when item (a `validate` from a `workflow_dispatch` run on the first release PR) cannot be proven by this PR. Leave it open; do not claim it.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to the branch's heading in the plan's `## Slices` section: the heading is `### The release workflow starts CI (Branch: infra/the-release-workflow-starts-ci)`, and annotate it inside the heading as `(Branch: infra/the-release-workflow-starts-ci, PR: #<number>)`.

### Scope guard

This branch owns `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `RELEASING.md`, `test/reconcile/release-pr-ci.test.mjs` and one file in `.changeset/`. Verified at dispatch 2026-10-02: no remote branch carries a diff against any of these. `changeset-release/main` exists on the remote; it is the target of this change and not a branch to touch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
