## Implementation brief — the-release-head-reports-validate-with (wave 2: Relay in the release workflow)

- **Plan (canonical):** docs/plans/2026-11-03-the-release-head-reports-validate-with.md on main
- **Approved:** 2026-11-06, Jan Wloka, plan-PR #3076 merged
- **Branch:** `bug/the-release-run-relays-validate` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention (`plot/review` is required on main)

One wave, one branch. It replaces the workflow that wave 1 (`feature/the-release-head-gets-validate`, #3209, merged) added. Nothing waits on it. Its live proof needs a release head cut after this merges.

### What to build

Move the relay from a `workflow_run` workflow into a job of `release.yml`, after `dispatch-ci`, and delete `.github/workflows/release-validate-relay.yml`. The job waits, bounded, for the dispatched `CI` run on the pinned head and writes that run's result as the `validate` commit status with `GITHUB_TOKEN`.

The failure it fixes, measured on 2.31.0 head `ce1ef4a1` (plan Decision 8): the dispatched `CI` run 42288492530 completed `success` at 20:40:35Z and started no `Release validate relay` run. The only relay run, 42290352662, came from the push run on `main` and skipped. `dispatch-ci` starts `CI` with `GITHUB_TOKEN` (triggering actor `github-actions[bot]`), and GitHub starts no workflow run from an event that token caused, except `workflow_dispatch` and `repository_dispatch`. So the `workflow_run` trigger never fires for the one run the relay exists for, and the release PR still needs a person to approve the held `pull_request` run.

The new job:

1. `needs: [release, dispatch-ci]`, gated on `needs.release.outputs.pr_number` like `dispatch-ci`. Its own `permissions:` block holds `actions: read` and `statuses: write`, and `contents: read` only if the lookup needs it. No other write.
2. Takes the pinned SHA from `needs.release.outputs.head_sha`. That output is the local ref `changesets/action` just pushed, which `release.yml` already treats as the one trusted source. The old relay read the remote branch ref because it ran in another workflow with no access to that output. Do not read the remote here.
3. Finds the dispatched run through the Actions API by workflow `ci.yml`, event `workflow_dispatch`, `head_sha` equal to the pinned SHA, `head_branch` `changeset-release/main`, path `.github/workflows/ci.yml` and actor `github-actions[bot]`. The run does not exist for a few seconds after `gh workflow run` returns, so the job polls for it inside the bound. Zero matches when the appearance window ends, or two matches, fail the job.
4. Polls the run until `status` is `completed`, inside one explicit bound. A timeout fails the job and writes no status.
5. Writes the commit status `validate` for the pinned SHA only, copying the run's own `success` or `failure`. A `cancelled` run, and any other conclusion, writes nothing and exits 0: the `release-dispatch` concurrency group cancels a superseded dispatched run, and a cancelled run is not a result.
6. Checks out nothing and installs nothing. No new `uses:`; `gh` is on the runner.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **Inside `release.yml`, not `workflow_run` and not an App-token dispatch (Decision 8).** `workflow_run` is measured dead for this run (above). Dispatching `CI` with an App token would start a `workflow_run`, but it adds a key secret to Actions and breaks the relay's own `github-actions[bot]` actor check. Do not build either.
- **Decision 7's reason still holds.** `release.yml` runs from `main` on a `push` to `main`, which the ruleset protects. The relay's file is therefore not editable by a release commit's author, which is why the relay is not a final job in `ci.yml`. Do not add a job to `ci.yml`.
- **`GITHUB_TOKEN`, never `Host.commitStatus`.** `Host.commitStatus` writes as the review App (5317669), the wrong integration. Never `plot-build` (5173644) or any bypass actor.
- **Do not trust the dispatched run's own pin.** Its guard lives on the unprotected branch. The job compares the run's `head_sha` to the pinned SHA itself and writes nothing on a mismatch.
- **Carry the old relay's checks over, do not weaken them.** `release-validate-relay.yml` holds the run filter (path, head SHA, head branch, actor), the exactly-one rule, the `completed` rule, and the `success|failure` rule. Read it before you delete it.
- **The wait costs concurrency.** `release.yml` has `cancel-in-progress: false` on `${{ github.workflow }}-${{ github.ref }}`, so a long wait holds the next release run in the queue behind it. The dispatched run's `validate` has `timeout-minutes: 25` (`ci.yml`, the `validate` job), so size the bound above that and state the figure and the queue effect in the PR description. Do not set `cancel-in-progress: true` to avoid the queue: it would cancel the `release` job mid-publish.
- **A failed relay fails the release run**, like a failed dispatch: it is the only signal the release PR carries no `validate`. No `continue-on-error`, no `|| true`. A red `CI` result is not a job failure: the job copies `failure` as the status and exits 0.
- **Out:** candidate (b), the non-bypass token. `validate` stays required with integration 15368, no new bypass actor, no ruleset change, `strict_required_status_checks_policy` unchanged. GitHub only.
- **The failure path stays unproved live, and the PR states so.** A red dispatched `validate` cannot be produced on a release head on purpose. One fact is still unmeasured: whether a `GITHUB_TOKEN` commit status satisfies the ruleset's `validate` from integration 15368. Only the first release head after this merges answers it (the plan's Live proof). If you find earlier evidence that it does not, report it and stop; do not switch to a check run or another mechanism.
- **Rules carried over:** absent is not passing — a lookup that errors or finds no run writes no status; a refusal ends the action and nothing retries with the pin dropped; read the exit code, not the emptiness, in every `gh` call.

### Done when

The plan's `### Tests` section for Outcome B (a) is the specification, now pointed at the job in `release.yml`. No local suite reads the ruleset or runs a workflow. Rewrite `test/reconcile/release-validate-relay.test.mjs`: it currently reads `release-validate-relay.yml`, so it fails once that file is gone. Keep its method (the workflow read as text, no YAML parser, every assertion scoped by `jobBlock`/`triggerBlock`). It asserts that the new job:

- holds `statuses: write` and no other write permission, in its own block. A whole-file match passes with the permission at workflow level or on another job.
- has no `actions/checkout` and no install step, and every `uses:` in `release.yml` stays pinned to a full SHA.
- `needs` `release` and `dispatch-ci`, and is gated on the PR number.
- takes the pinned SHA from `needs.release.outputs.head_sha` and does not read `git/ref/heads/changeset-release/main`. This catches a copy of the old relay that reads the remote the guard distrusts.
- writes context `validate`, names no `Host.commitStatus` path or App secret, and writes nothing for `cancelled`. Assert the text of both guards.
- has a `timeout-minutes` above the dispatched run's 25.
- `release-validate-relay.yml` no longer exists, and `release.yml` declares no `workflow_run` trigger. This catches a deletion that leaves the dead workflow behind.
- the `release` job's permissions stay unchanged and carry no `actions: write` (the existing assertion in `release-pr-ci.test.mjs`, which must still pass).

Comments to correct: `release.yml:150-155` (names the removed workflow) and `ci.yml:30-35` (also names it). Both state the measured outcome and point at the new job. Comment lines only in `ci.yml`. Check `release-pr-ci.test.mjs` and the last test of the relay test file for wording they pin.

Plus: the merged changeset `.changeset/the-release-head-gets-validate.md` still names `release-validate-relay.yml` and a `workflow_run` trigger, and 2.31.0 is not yet published. Amend that changeset in place so the changelog states the current behaviour, and add no second one. Keep the description first and the `plan:` comment last; run `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. A workflow path selects every CI job, and the suites in the `CI suites` key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice touches no `.sh` file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. Do not claim the plan delivered: it stays open until jwloka records the live proof on the first release head after the merge. State in the PR description the wait bound, the queue effect, and that the failure path is unproved live. Remove the old workflow with `trash`, not `rm`.

### Scope guard

Owns: the new job in `.github/workflows/release.yml` and the comment above `dispatch-ci`; the deletion of `.github/workflows/release-validate-relay.yml`; the comment lines at `ci.yml:30-35`; `test/reconcile/release-validate-relay.test.mjs`; `test/reconcile/release-pr-ci.test.mjs` only where it pins old wording; `.changeset/the-release-head-gets-validate.md`.

In flight, checked at brief time on 2026-11-06: of the open PRs, only sprint PR #3204 (`sprint/card-alignment`) is listed, and it touches no workflow file. Do not edit the `release` job or the `dispatch-ci` job's steps, the `ci.yml` jobs, `.github/workflows/build-bundles.yml`, `CLAUDE.md` or `AGENTS.md`. Do not write host state to a release PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
