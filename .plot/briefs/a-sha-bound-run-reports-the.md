## Implementation brief — a-sha-bound-run-reports-the (wave 1: Sha Of A Run)

- **Plan (canonical):** `docs/plans/2026-10-20-a-sha-bound-run-reports-the.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2165 merged
- **Branch:** `bug/a-sha-bound-run-reports-the` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

Wave 2 (`bug/jenkins-runs-skip-builds-that-did`) waits on this branch: both edit the one jq program in `jenkins_sha_runs`.

### What to build

Under `CI: jenkins` with merge-before-build, every build carries two `lastBuiltRevision` entries: the tip of the target branch first, the branch head second. Measured 2026-10-20 on ewz-kus-portal: `plot-host.sh runs-for-sha bug/fix-kafka-topic-name 66836536f8c9…` matched the right build and returned `.sha` = `bd70636876302e7974b84ff8a7e947d068c485cd`, the tip of `develop`. The match uses `any(shas)`; the last jq stage, `map(.sha = (.shas | first // "") | del(.shas, .br))` (`skills/plot/scripts/plot-host.sh:1788`), then discards the match and reports `first`.

Change only that jq program in `jenkins_sha_runs`:

- With a sha: `.sha` is the entry of `shas` that the match selected (exact, or prefix when the asked sha is a 7+ hex short hash).
- With no sha (`runs`): `.sha` is the branch head, meaning the entry whose `lastBuiltRevision.branch` names the branch, and the last entry when none does. The plan lists this as an open question; check it against the fixture you build, and record the answer in the plan's Open Questions before the PR.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **The fix stays inside `jenkins_sha_runs`.** It is the one place that reads `lastBuiltRevision` (`runs`, `run-for-sha`, `runs-for-sha` all go through it, lines 4547 and 4628). A fix in a caller would leave the other two wrong.
- **Do not change the match.** `any(.shas[]?; . == $sha or (prefix test))` selects the right build today. Only the reported value is wrong. Changing the match risks the sha-bound binding that `2026-10-19-jenkins-checks-never-bind-to-the` delivered.
- **`first` is wrong, and `last` is not the replacement.** The merge-base order is a property of merge-before-build jobs; a plain job has one entry, and a job without the merge step may order differently. Selecting the matched entry needs no assumption about order.
- **The `runs` arm already drops `.sha`** (`jq -c '.[] | {workflow, conclusion, startedAt, url}'`, line 4549), so the no-sha reading only shows through `run-for-sha`/`runs-for-sha` callers that pass no sha. Slice 1 reads every consumer of `.sha` (`plot-jenkins-pr-checks.mjs` `bind`, `build-runs-for-sha`, BuildMonitor) and states in the PR which, if any, relied on the merge-base value. The plan expects none: `bind` takes `checksSha` from the sha asked.
- **The `NOT_BUILT`/`ABORTED` filter is wave 2.** Do not add it here.
- **Carried-over rules:** absent is not false (a build with no `lastBuiltRevision` keeps `.sha` = `""`); exit 4 means *cannot be asked*, never *no run*; read the exit code, not the emptiness.

### Done when

The plan's slice line is the specification: `jenkins_sha_runs` reports the matched sha in `.sha`, with a fixture test of two `lastBuiltRevision` entries. The assertions that exist because a naive fix passes without them:

- **The fixture's two entries differ.** With equal entries `first` and the matched entry agree and the test passes against the unfixed code. Run the new test against `main`'s `plot-host.sh` first and see it fail.
- **Assert the matching entry in both positions.** One case where the asked sha is the first entry, one where it is the second. A fix that switches `first` to `last` passes only one of them.
- **Assert a prefix match.** Ask with a 7-character short hash and expect the full sha in `.sha`.
- **Assert `run-for-sha`, `runs-for-sha` and `runs`** (the plan names all three). Extend `jenkinsBuildsFor` in `test/reconcile/host.test.mjs` (line 2790), which builds one-entry fixtures today; give it an optional second entry and keep the existing callers unchanged.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `host.test.mjs` is slow under load: run the test names you touched (`node --test --test-name-pattern=…`), not the whole file in a loop. Add a changeset (`plot: patch`, description first, `bumps:` block last, `plan:` line inside the block). `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: replace the one jq stage in place and add no lines to the shell, so the change stays net zero.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices` section when it exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the jq program in `jenkins_sha_runs` in `skills/plot/scripts/plot-host.sh`, the fixture and tests in `test/reconcile/host.test.mjs`, the changeset, and the plan's Open Questions. In flight: `bug/jenkins-runs-skip-builds-that-did` (wave 2, waits on this branch) edits the same jq program. `2026-10-20-bitbucket-jenkins-pr-list-rows-past` overlaps in files and not in scope; rebase on `main` before opening the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
