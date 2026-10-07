## Implementation brief — the-fleet-loop-reads-its-runs-right (wave 1: A run no runner took is no answer)

- **Plan (canonical):** `docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-run-no-runner-took-is-no-answer` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the first wave of four. Waves 2 to 4 wait on this one merging (`rules/eligible.ts:131-134`), and nothing waits on them.

### What to build

On 2026-10-05 from 19:48 UTC GitHub Actions reported `degraded_performance`. Jobs failed with *The job was not acquired by Runner of type hosted even after multiple attempts*: the job is `cancelled` after 15 minutes, with 0 steps and an empty runner name, and the run concludes `failure`. Of 30 `ci.yml` runs between 19:48 and 21:37 UTC every finished run failed this way (#1295). On `infra/an-agent-run-is-a-port` (#1293) the loop wrote *failed after 2 corrections* for run 37370755198, whose `validate` job never started (20:36 to 20:51, 0 steps). `checksFromRuns` reads `failure` as `settled` (`SETTLED_CONCLUSIONS`, `checks-verdict.ts:127`), and `worker-loop.ts:809-819` turns `settled` plus `conclusion !== 'success'` into a correction. A host outage can spend a slice's whole correction budget.

The change makes `checksFromRuns` read such a run as no answer yet: it stays `wait` inside `Checks wait` and ends `no-answer` at the bound, which `agent-loop.ts:755` already turns into `checks-unanswered` with no correction. The loop's end-of-wait handling needs no edit.

Measured on `main` at `2fb9729f7`, 2026-10-07. **The plan's wording hides a missing reading.** It says the rule reads "a run whose failed or cancelled jobs ran 0 steps", but `ShaRun` (`entities/build.ts:147`) carries only `sha`, `status`, `conclusion`, `url` and `startedAt`, and `plot-host.sh run-for-sha` (`:4337`) asks `gh run list --json headSha,conclusion,status,startedAt,url`. No job, step or annotation reaches the rule, and `git grep "gh run view" skills/plot/scripts/plot-host.sh` finds nothing. The rule cannot be written until the data exists. Three layers change, in this order:

1. **The collector reports job facts.** For a GitHub run whose conclusion is `failure` or `cancelled`, `run-for-sha` makes one more call, `gh run view <databaseId> --json jobs`, and adds a `jobs` array of `{conclusion, steps}` (`steps` is the step count). `gh run list` needs `databaseId` added to `--json`. A run that is still going or succeeded costs no extra call. The script reports counts and decides nothing (Manifesto Principle 3).
2. **The adapter and entity carry it.** `RawShaRun` and `shaRunOf` (`adapters/build/build-shell.ts:16`, `:64`) read `jobs`; `ShaRun` gains an optional `jobs`. Absent is not empty: a Jenkins run, a fixture and a script that printed no `jobs` leave it `undefined`, and the rule reads `undefined` as "no reading", never as "0 steps".
3. **The rule reads it.** A pure function in `rules/checks-verdict.ts` answers true when the run concluded `failure` or `cancelled`, `jobs` is present and non-empty, and every job whose conclusion is `failure` or `cancelled` has 0 steps. `checksFromRuns` applies it before the `settled` test. `worker-loop.ts` changes nowhere.

### The decisions the plan settles — do not re-derive them

**Wait; do not re-run the workflow.** The plan's open question is answered: the plan waits, because a re-run spends CI minutes during a host outage. Do not add a `gh run rerun` call.

**Read the step count; do not read the annotation.** The issue allows "0 steps, or the not-acquired annotation". The annotation lives behind `gh api repos/<r>/check-runs/<job id>/annotations`, one call per job, while `jobs[].steps` arrives in the one `gh run view` call. The failing run measured in #1295 shows both signals together (cancelled, 0 steps, empty runner name), so 0 steps alone catches it. If you find a not-acquired run that has steps, report it as a plan gap; do not add the annotation call on your own.

**A job with steps that failed is a real failure.** The rule requires EVERY failed or cancelled job to have 0 steps. A run with one job that never started and one that ran a test step and failed is a build failure, and the agent is owed the correction. A test names this: a rule that asks "any job with 0 steps" passes the outage case and hides this one.

**The rule is not a Jenkins rule.** Jenkins has no unacquired state and its arm prints no `jobs`. Do not edit the Jenkins arm.

**`buildFindingFor` is wave 4's.** It reads `run.conclusion` for the finding word. Do not touch it here, and do not make `checksFromRuns` change what it receives. After this change an unacquired run keeps `buildRun: null` in the loop (`worker-loop.ts:821`, `checks === 'settled' ? run : null`), so no finding is published for it. Wave 4 widens `buildRun`; whether a finding then names the outage is wave 4's decision.

**Rules carried over unchanged.** Absent is not false: a missing `jobs` field never turns a failure into no answer. A failing `gh run view` exits 4 as the `gh run list` call does (`plot-host.sh:4503`), so the connector answers `failed` and the wait keeps going; it never reads as "no steps". A function you write or rewrite is an arrow. TSDoc states what an export does and how it fails; the reasoning goes in the commit message.

### Done when

The plan's `## Done when` item for this slice is the specification: `checksFromRuns` over a failed run with 0 steps answers `no-answer` at the bound (and `wait` before it), and the loop hands back no correction for it. Assertions that exist because a naive implementation passes without them:

- **Wait, then `no-answer`.** Assert `checksFromRuns` answers `wait` for the unacquired run with `waitedSeconds` under the bound and `no-answer` at it. A rule that answers `no-answer` at once passes the "no correction" test and ends the wait early.
- **Loop level.** In `packages/board/test/unit/worker-loop-run.test.ts` (it already drives `runForSha`), feed an unacquired run and assert `correctionText` is empty and `checksPassed` is `null`. This catches a rule that works in the domain test while the loop still reads `conclusion` directly.
- **Mixed jobs.** One 0-step cancelled job beside one failed job with steps answers `settled`, and the correction is handed back.
- **Absent `jobs`.** A `failure` run with no `jobs` field answers `settled`. This catches an implementation that reads absence as "no steps".
- **Collector.** In `test/reconcile/host.test.mjs`, a stubbed `gh` shows `run-for-sha` printing `jobs` for a `failure` run, no `gh run view` call for a `success` or running run, and exit 4 when `gh run view` fails. Mutate the call out and see the first assertion fail before you trust it.
- **Adapter.** `packages/domain/test/build-shell.test.ts` shows `shaRunOf` carrying `jobs` through and leaving it `undefined` when absent.

Plus the repo's gates: a changeset with the description first and the `bumps:` block last (`'plot': patch`, with `plot-dispatch` untouched; add a `'@plot-pm/board'` changeset only if the board package changes). `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds lines to `plot-host.sh`, so the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Check `scripts/check-host-cli-callers.sh` too: the new `gh` call sits inside `plot-host.sh`, which is the one place allowed to hold it. The `skills/plot/scripts/README.md` row for `plot-host.sh` changes if its `run-for-sha` description does.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 24 (`nvm use`).

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names the issue (#1295) and states which of the plan's two signals (steps, annotation) the rule reads.

### Scope guard

This branch owns the run reading and its data path:

- `packages/domain/src/rules/checks-verdict.ts`, `packages/domain/src/entities/build.ts`, `packages/domain/src/adapters/build/build-shell.ts` and `build-fixture.ts` (only if the fixture needs a `jobs` case), and their tests (`checks-from-runs.test.ts`, `build-shell.test.ts`)
- `skills/plot/scripts/plot-host.sh` (the `run-for-sha` GitHub arm only), `test/reconcile/host.test.mjs`, the `plot-host.sh` row in `skills/plot/scripts/README.md`
- `packages/board/test/unit/worker-loop-run.test.ts` for the loop-level assertion

Not this branch's: `buildFindingFor` and `buildRun` (wave 4), `dollarsOrUnset` (wave 2), the charter and `.gitignore` (wave 3). Do not edit `worker-loop.ts` beyond what a failing test proves necessary, and report it if you do.

Other branches in flight, checked 2026-10-07 on origin: `bug/continue-owns-the-desk-it-starts` and `bug/deliver-reads-the-plan-at-the-pulse-ref`. Neither names a file in the list above; `continue.ts` is theirs. `changeset-release/main` is the release PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
