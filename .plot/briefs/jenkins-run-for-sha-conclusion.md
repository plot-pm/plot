## Implementation brief — the-agent-s-ci-wait-never (wave 1: Tracer)

- **Plan (canonical):** `docs/plans/2026-10-16-the-agent-s-ci-wait-never.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1868 merged
- **Branch:** `bug/jenkins-run-for-sha-conclusion` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's tracer and has no wave before it. Wave 2 (`bug/jenkins-credential-from-env`, `bug/jenkins-default-branch-workflow`) runs independently of it; wave 3 and later wait on `bug/jenkins-default-branch-workflow`, not on this branch.

### What to build

On Jenkins, a finished build never settles the fleet agent's CI wait. `plot-host.sh run-for-sha` prints Jenkins' own `result` word (`SUCCESS`, `FAILURE`) from `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh`, the `conclusion:` line of the jq filter near `:1726`). `buildJenkins.runForSha` in `packages/domain/src/adapters/build/build-jenkins.ts` (near `:107`) passes it through unmapped. `checksFromRuns` settles only on lowercase `success`, `failure` and `action_required` (`rules/checks-verdict.ts`, `SETTLED_CONCLUSIONS`), so the run reads as no run. Every Jenkins fleet agent waits the full `Checks wait` (3600 s), ends `checks-unanswered` with a `PLOT-BLOCKED` marker, publishes no `build passed` or `build failed` finding, and writes no `PLOT-CORRECTION.md` entry for a red build.

The fix: `runForSha` maps `conclusion` through the existing `jenkinsConclusion` (`build-jenkins.ts:22`), as `runsForSha` already does at `:116`. A `null` run passes through as `null`. Then add the test that does not exist today. A worker-loop (`workflows-agent-loop.test.ts`) fixture with a `SUCCESS` run settles to `build passed`, and one with `FAILURE` settles to `build failed`. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **Map at the adapter edge, not in the rule.** Teaching `SETTLED_CONCLUSIONS` or `checksPassed` (`worker-loop.ts:884`, compares with `'success'`) the Jenkins words would put a vendor vocabulary in the domain and break the layering rule in `CLAUDE.md`. `runsForSha` already maps at the edge; `runForSha` is the one arm that skipped it.
- **No new helper.** Plan Notes: `jenkinsConclusion` exists and is applied at `:116` only. Extend its use.
- **Do not change the shell.** `plot-host.sh` keeps printing Jenkins' word. `check-shell-lines.sh` refuses growth of shipped shell, and the mapping is the domain's.
- **`ABORTED` becomes `cancelled`, `NOT_BUILT` becomes `unknown`, `UNSTABLE` becomes `failure`.** These come from `jenkinsConclusion` and stay as they are. The `aborted` and `notbuilt` handling in PR rows belongs to `bug/jenkins-pr-checks-bind-to-head`.
- **Absent is not green.** A `null` conclusion (still building) must not settle. The test must include a building run that does not settle.

### Done when

The plan's `## Slices` entry and Changelog line 1 are the specification: on Jenkins the wait settles on `build passed` or `build failed` instead of ending `checks-unanswered`. Assertions that exist because a naive implementation would pass without them:

- A test through `buildJenkins(...).runForSha` with a raw `SUCCESS`/`FAILURE` shell answer asserts the lowercase word. This catches mapping in the wrong layer, since a worker-loop test with a pre-mapped fixture passes without the fix.
- A worker-loop test that feeds the raw adapter result, not a hand-built `ShaRun`, catches the original defect end to end.
- A `null` conclusion stays unsettled and a `NOT_BUILT` run does not read as passed.

Plus: add a changeset (description first, `bumps:` block last, `plan:` line inside it; package `plot` or `@plot-pm/board`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if it does, `scripts/check-shell-lines.sh` requires an equal removal in the same change.

New functions are arrow functions. TSDoc states what an export does and how it fails; reasoning goes in the commit message.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/adapters/build/build-jenkins.ts`, `packages/domain/test/build-runs-for-sha.test.ts` or `packages/domain/test/workflows-agent-loop.test.ts`, and one changeset. Branches in flight on the plan: none are claimed. The sibling slices touch `plot-host.sh` (`jenkins_rest_credential`, `jenkins_sha_runs`, `jenkins_build_map`) and `default-branch.ts`; stay out of them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
