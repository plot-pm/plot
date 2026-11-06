## Implementation brief — the-release-head-reports-validate-with (wave 1: Relay)

- **Plan (canonical):** docs/plans/2026-11-03-the-release-head-reports-validate-with.md on main
- **Approved:** 2026-11-06, Jan Wloka, plan-PR #3076 merged
- **Branch:** `feature/the-release-head-gets-validate` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention (`plot/review` is required on main)

One wave, one branch. Nothing waits on it and it waits on nothing. Its live proof needs a release head cut after this merges: release PR #3080 (2.31.0) is open now and does not carry the relay.

### What to build

A new workflow file that copies a completed dispatched `CI` run's result to a `validate` commit status on the release PR's pinned head, so the release PR counts `validate` with no person approving the held `pull_request` run.

The failure it fixes, measured on 2.31.0 (PR #3080, head `756660c6`): at 2026-11-06T17:14:23Z the dispatched run 42257612120 had completed `success` with seven check runs from app 15368 reading `success`, and `mergeStateStatus` still read `BLOCKED`. After a person approved the held `pull_request` run 42257438360, `mergeStateStatus` read `CLEAN` at 17:27:24Z. The dispatched run's `validate` is not what GitHub's ruleset counts. A relay that makes the dispatched result count removes the person step.

Build it as `.github/workflows/<name>.yml` (pick a name that says release and relay) with one job, triggered by `workflow_run` of `CI`, type `completed`. Name the job anything but `validate`: a check run named `validate` from this workflow would be a second `validate` source. The job:

1. Runs only when the completed run's event is `workflow_dispatch`. Every `CI` run on a PR or a push also fires `workflow_run`, so the filter is the first line of the job (`if:`), not a late exit.
2. Finds the dispatched run through the Actions API by event `workflow_dispatch`, path `.github/workflows/ci.yml`, `head_sha` equal to the pinned SHA and actor `github-actions[bot]`. Zero matches or two matches fail the job.
3. Writes the commit status `validate` for the pinned SHA only, with `GITHUB_TOKEN`, copying the run's own `success` or `failure`, and only after the run's `status` is `completed`. A `cancelled` run, and any conclusion other than `success` or `failure`, writes nothing: the `release-dispatch` concurrency group cancels a superseded dispatched run, and a cancelled run is not a result.
4. Checks out nothing and installs nothing. Its permissions are `statuses: write` plus read permissions the Actions lookup needs, and no other write. It has a `timeout-minutes`. A timeout fails the job and writes no status.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **A `workflow_run` workflow, not a final job in `ci.yml` (plan Decision 7).** A `workflow_run` workflow runs its file from `main`, which the ruleset protects. A final `ci.yml` job on the dispatched event runs the file from `changeset-release/main`, which has no branch protection and no ruleset (404 on 2026-10-01); the release commit's author could change the relay there. Do not add a job to `ci.yml`. A consequence: `ci.yml`'s `permissions: contents: read` (the block at `ci.yml:47-51`) does not change, because the new permission lives in the new file. The plan's line "under (a) the permissions comment changes" describes the rejected variant; leave that comment alone.
- **`GITHUB_TOKEN`, never `Host.commitStatus`.** `Host.commitStatus` writes as the review App (5317669), and a `validate` written by it carries the wrong integration. Never `plot-build` (5173644) or any other bypass actor. Add no App key, no secret and no new `uses:` unless it is SHA-pinned, and prefer `gh`, which the runner has, as `release.yml`'s `dispatch-ci` does.
- **Do not trust the dispatched run's own pin.** The run's guard (`ci.yml:112-127`, the `Guard the dispatched run` step) lives on the unprotected branch, so a hostile commit there can remove it. The relay compares the SHA itself: the run's `head_sha` must equal the current head of `changeset-release/main`, and the run's `head_branch` must be `changeset-release/main`. Read that head from the API in the relay job; the plan leaves the exact source to you, so pick the branch ref and say so in the PR description. A mismatch writes nothing.
- **Candidate (b), the non-bypass token, is out.** It needs a new App and secret and a measurement of whether GitHub holds a `pull_request` run on an App-authored PR as well. The plan chose (a) on 2026-11-06, after the 2.31.0 record. Do not build a fallback toward (b).
- **`validate` stays required with integration 15368, no new bypass actor, no ruleset change, and `strict_required_status_checks_policy` unchanged.** These are the plan's invariants for every candidate. Do not touch the ruleset.
- **GitHub only.** The changesets action, the `action_required` hold and ruleset `24412719` have no Bitbucket or Jenkins arm. Nothing in this slice reaches another host.
- **The failure path stays unproved live, and the PR states so.** A red dispatched `validate` cannot be produced on a release head on purpose. The contract test carries what can be asserted locally.
- **Rules carried over:** absent is not passing — a lookup that errors, or a run that is not found, writes no status; a refusal ends the action and nothing retries with the pin dropped; read the exit code, not the emptiness, in every `gh` call.

One unmeasured fact sits under this design and the plan names it as an open question: whether GitHub starts a `workflow_run` workflow for a dispatched run on `changeset-release/main`, and whether a commit status from `GITHUB_TOKEN` satisfies the ruleset's `validate` with integration 15368. Only the first release head after this merges answers it (the plan's Live proof). If you find evidence earlier that the status does not satisfy the rule, report it and stop; do not switch the relay to a check run or to another mechanism on your own.

### Done when

The plan's `### Tests` section for Outcome B (a) is the specification. No local suite reads the ruleset or runs a workflow. The contract test is `test/reconcile/release-validate-relay.test.mjs`, written like `test/reconcile/release-pr-ci.test.mjs`: it reads the workflow files as text, adds no YAML parser, and scopes every assertion to a named block (`jobBlock`, `triggerBlock`) so an assertion fails when the thing it looks for sits in a sibling block. It asserts that the relay job:

- holds `statuses: write` and no other write permission. Lift this because a whole-file match for `statuses: write` passes with the permission at workflow level or on another job.
- has no `actions/checkout` step and no `pnpm install` or other install step.
- pins every `uses:` to a full SHA (none is also valid).
- is triggered by `workflow_run` of `CI`, not by `pull_request`, `push` or `workflow_dispatch`, and filters on the `workflow_dispatch` event.
- writes status context `validate` and names no `Host.commitStatus` path or App secret.
- compares the SHA itself and writes nothing for `cancelled`. Assert the text of both guards.

Also, in `release-pr-ci.test.mjs` or its own file: the corrected comments hold. `ci.yml:30-33` no longer says the dispatched run's `validate` "is the context the branch protection requires, so the required check reports", and `release.yml`'s `dispatch-ci` header comment (about lines 141-159) no longer says the dispatch makes the required check report. Both comments state the measured outcome: on 2.31.0 the dispatched `validate` did not lift `BLOCKED` and the relay carries it. Read the existing assertions in `release-pr-ci.test.mjs` first; they may pin the old wording.

Plus: one changeset for `plot`, description first and the `bumps:` block last if you name one (`./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. A workflow path selects every CI job, and the suites in the `CI suites` key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file, and if it does, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. Do not claim the plan delivered: the plan stays open until jwloka records the live proof on the first release head after the merge. State in the PR description which source you chose for the pinned SHA and that the failure path is unproved live.

### Scope guard

Owns: the new `.github/workflows/<relay>.yml`, the comment corrections at `.github/workflows/ci.yml:30-33` and in `.github/workflows/release.yml`'s `dispatch-ci` header (about lines 141-159), `test/reconcile/release-validate-relay.test.mjs`, a change to `test/reconcile/release-pr-ci.test.mjs` only where it pins the old wording, and one changeset.

In flight, checked at brief time on 2026-11-06: PR #3198 (`feature/one-card-grammar-plans`) adds one step to `ci.yml` near line 1680, far from the comment lines you edit; a rebase onto it is a clean merge. PR #3205, PR #3204 and release PR #3080 touch no workflow file. Do not edit the `ci.yml` jobs, the `dispatch-ci` job's steps, `.github/workflows/build-bundles.yml`, the `release` job in `release.yml`, `CLAUDE.md` or `AGENTS.md`. Do not write host state to release PR #3080.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
