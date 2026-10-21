## Implementation brief — jenkins-run-for-sha-can-answer

- **Plan (canonical):** `docs/plans/2026-10-21-jenkins-run-for-sha-can-answer.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2225 merged
- **Branch:** `bug/jenkins-run-for-sha-can-answer` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One wave, one branch. Nothing waits on it and it waits on nothing.

### What to build

Under `CI: jenkins`, `plot-host.sh run-for-sha` and `runs-for-sha` can answer a `NOT_BUILT` build as the run for a sha. Observed: a head whose only build is `NOT_BUILT` reads as completed/`NOT_BUILT` instead of "no run", and a newer `NOT_BUILT` build hides an older FAILURE or SUCCESS of the same sha (`run-for-sha` takes `.[0]`, `plot-host.sh:4719`; `newestPerSha` in `build-jenkins.ts:50-58` does the same on the TypeScript side).

The fix is one jq expression. In `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1808`) the filter `(if $sha == "" then map(select(.conclusion != "NOT_BUILT" and .conclusion != "ABORTED")) else . end)` becomes: `NOT_BUILT` is dropped on every arm, and `ABORTED` is dropped only when `$sha == ""`. Do the drop before the sha match on line 1809. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **`ABORTED` stays in the sha arms.** #2181 kept both there on the ground that a cancellation of that exact sha did happen. That ground fails for `NOT_BUILT` (nothing ran; `jenkinsConclusion` maps it to `unknown`, `build-jenkins.ts:15`, `:31-32`) and holds for `ABORTED`. Decided in the challenge of 2026-10-21. Do not drop `ABORTED`.
- **No consumer reads a `NOT_BUILT` row.** Every consumer reads it as `unknown`, and the plan lists the three effects (agent CI wait, default-branch reading, board PR binding). Do not add a consumer-side filter.
- **The fix stays in the jq program of `jenkins_sha_runs`**, the one place that reads `result`. Do not touch `build-jenkins.ts`.
- **Not fixed here:** the sha match at `plot-host.sh:1809` (`any(.shas[]; …)`) accepts a merge-before-build job's merge-base revision. That is #2229. Leave line 1809's match rule alone.
- Rules carried over: absent is not false — a sha with no surviving build must answer empty (`run-for-sha` prints nothing, `runs-for-sha` prints `[]`), not an error; read the exit code, not the emptiness (exit 4 still means "cannot be asked").

### Done when

The plan's `Slices` line is the specification: `NOT_BUILT` skipped in the sha arms, three single-revision fixtures, and the renamed `ABORTED` test.

- Rename `host.test.mjs:3647` to say the sha arms still return an `ABORTED` build, and rewrite its comment (it currently claims `NOT_BUILT` is kept too). It uses `jenkinsBuildsFor('sha-aborted', 'ABORTED')` (`:2872`, one build, one revision).
- Fixture 1: a sha whose only build is `NOT_BUILT` — both arms answer none/empty. Catches the filter applied to one arm only.
- Fixture 2: a `NOT_BUILT` build newer than a `FAILURE` of the same sha — `run-for-sha` answers `FAILURE`. `jenkinsBuildsFor` builds a single build; write a two-build JSON inline. This is the case a naive "drop it from the output" passes without: the drop must precede `.[0]`.
- Fixture 3: an `ABORTED` build — still returned. Catches over-dropping.
- Delete or amend the `ABORTED`/`NOT_BUILT` wording in `.changeset/jenkins-runs-skip-builds-that-did.md` only if it is still unreleased; otherwise add a new changeset (description first, `bumps:` block last, `plan:` line in the block): `plot: patch`, skill `plot`.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Run `test/reconcile/host.test.mjs` by the test names you touched, not the whole file (it can stall under load).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. The edit to `plot-host.sh` should be line-neutral or shorter; keep it so. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owns: `skills/plot/scripts/plot-host.sh` (the `jenkins_sha_runs` jq only), `test/reconcile/host.test.mjs`, one changeset. In flight on the same arm: `bug/a-sha-lookup-matches-a-build` (the sha-match defect family, #2229) — it may touch line 1809, so keep your edit to the filter on line 1808 and rebase if it lands first.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
