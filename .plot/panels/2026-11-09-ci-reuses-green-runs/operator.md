# Operator verdict: ci-reuses-green-runs

Lens: what a person sees on the PR's checks page when a job is reused, whether they can tell the source run and force a fresh run, and what happens when the reuse read fails.

Position: amend

## Open Questions

- **Where the base SHA is recorded.** Use the artifact. The workflow already uploads two artifacts with SHA pins (`ci.yml:687`, `:832`), and the name is readable from the list endpoint without a download. Add one condition: the list endpoint also returns expired artifacts, with `expired: true`, so the read must drop expired records. Without that, the plan's claim "the 7-day retention of the record bounds how old a source can be" is false.
- **`gh api` in the workflow or a `plot-host.sh` op.** Use `gh api` in the step. `check-host-cli-callers.sh` scans only `*.sh` under `skills scripts hooks`, and `release.yml:261-272` already holds the three-attempt `api()` retry to copy. State the call count in the plan: one run list plus two calls per run, so up to 41 calls per push, and up to 123 with retries, against the 1,000 per hour of `GITHUB_TOKEN`.
- **A failed run as a source.** Keep it. Each job result stands alone, and `validate` (`ci.yml:2659-2668`) already reads them one by one. The summary must say that the source run ended `failure`, so a person does not read a green check as "the last run was green".

## Leftovers

- **Dependency on `ci-cancels-superseded-runs`.** Confirmed. `origin/idea/ci-cancels-superseded-runs` exists and holds `docs/plans/2026-11-09-ci-cancels-superseded-runs.md`. Its slice branch is `infra/ci-cancels-superseded-runs`. Its group key is `format('pr-{0}', github.event.pull_request.number)` for `pull_request` runs, `github.run_id` for a `pull_request` run whose `head_ref` is `changeset-release/main`, and `github.run_id` for a push. The subject plan's statement "gives a pull request's runs one concurrency group" agrees, and it changes no line of `ci.yml:57-68`. Name the slice branch in the subject plan, not only the idea branch.
- **Reuse rule (base SHA unchanged).** Handled. The rule compares the recorded `HEAD^1` and reads no branch name.

## What a person sees and cannot do

1. **The source run is not carried to `validate`.** The plan says `validate`'s step summary "names each reused job, its source run and its head SHA". The output value is `reused:<40 hex>`, which holds the head SHA only. `validate` reads only `needs.*` outputs, so it cannot name the run id. Change: `select` writes the reuse table to its own step summary (job, source run id as a link `${{ github.server_url }}/${{ github.repository }}/actions/runs/<id>`, source head SHA, base SHA, source run conclusion), and emits one `::notice title=reused::<job> reused from run <id> at <sha>` per job. Alternatively, widen the value to `reused:<run id>:<40 hex>` and widen `validate`'s regex to match. Add a Done-when row for either.
2. **A skipped job on the checks page shows no reason.** GitHub shows a reused job as a grey `skipped` with no text, the same as a job the selection did not name. The plan cannot change that page. The `select` notice above is the one place on the checks page that a person sees without opening the run summary. State this in the Changelog, so a person knows where to look.
3. **No path forces a fresh run.** "Re-run all jobs" re-runs `select`, which reads the same earlier runs and reuses again. Re-running one skipped job reads the same `select` outputs and skips again. An empty commit gives an empty head diff and reuses every job. The plan itself names the cost: "A flaky test that passed once stays reused until the base moves". Change: the bundle prints empty `reuse_*` outputs when `github.run_attempt` is greater than 1, so "Re-run all jobs" is a full run. Add a Done-when row: `plot-ci-reuse.mjs` with `run_attempt=2` prints every `reuse_*` empty. Name this in the Changelog.
4. **A failed read looks like "nothing to reuse".** `continue-on-error: true` keeps the job green, and every job runs. That is the right failure direction, but a person who sees a 45-minute run cannot tell a failed read from a moved base. Change: the read step and the bundle write one summary line and one `::warning::` on failure ("reuse read failed at <call>: every selected job runs"). For each reusable job that runs, the summary names the reason: base moved, input changed, no record, source cancelled, or read failed. `ciReuse` already decides each condition, so it can return the reason with the answer.
5. **A malformed value fails late.** A non-empty, malformed `reuse_*` value skips the job (`!= ''`) and then fails `validate`. The error line must name the `select` output and the value, and with change 3 the person's next action is "Re-run all jobs". Make the job condition and `validate` read the same regex, so a malformed value runs the job instead of failing the PR. That moves the failure direction to "run".

## Other gaps

- **The release PR is not excluded.** The plan excludes `workflow_dispatch` but not the `pull_request` run on `changeset-release/main`, which is the run whose `validate` the ruleset counts after a person approves (cancels plan, *Motivation*). A release approver then sees a green `validate` built partly on jobs from an earlier head. Exclude `github.head_ref` starting with `changeset-release/` in the bundle, as the cancels plan excludes it from the group, or state why reuse there is safe.
- **`checks-verdict.ts` is not affected.** `runWasTimedOut` (`checks-verdict.ts:215-229`) reads only `cancelled` runs; a reused job is `skipped` in a run that concludes `success`. The board impact claim holds.

## The one change that matters most

Make "Re-run all jobs" a full run (`github.run_attempt > 1` gives empty `reuse_*` outputs). Without it, a person who doubts a reused green has no action short of moving the base, and the plan's own flaky-test case has no exit.
