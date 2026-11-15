## Implementation brief — ci-cancels-superseded-runs

- **Plan (canonical):** docs/plans/2026-11-09-ci-cancels-superseded-runs.md on main
- **Approved:** 2026-11-11, jwloka, plan-PR #3305 merged
- **Branch:** `infra/ci-cancels-superseded-runs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This plan has one slice (`Cancel`). Nothing waits on it and it waits on nothing.

### What to build

A push to a pull request must cancel CI still running on that pull request's older head. Observed failure: on 2026-11-09 sprint PR #3277 took eight pushes in about 40 minutes, no run was cancelled, and the run on the current head (42602121182) sat with `checks`, `corpus`, `helper-contracts` and `board-integration` queued until a person cancelled eight older runs by hand. A full run holds about seven runners for about 25 minutes.

The change sits on the top-level `concurrency:` block of `.github/workflows/ci.yml`. Today it reads `ci-${{ github.event_name == 'workflow_dispatch' && 'release-dispatch' || github.run_id }}` with `cancel-in-progress: true`, so every non-dispatched run has its own group and nothing supersedes anything. The new group has three arms:

- a dispatched run: `release-dispatch`, unchanged;
- a `pull_request` run whose `github.head_ref` is not `changeset-release/main`: `pr-<github.event.pull_request.number>`;
- every other run (a `main` push, and the release PR's `pull_request` run): `github.run_id`, so it is never cancelled.

Three contract rows in `test/reconcile/release-pr-ci.test.mjs` replace the row "ci.yml shares one concurrency group across dispatched runs and isolates every other run", and the comment above the block is rewritten to state the new rule. The slice also settles `runWasTimedOut` (`packages/domain/src/rules/checks-verdict.ts`), which Open Question 2 covers below. Read the plan; it is canonical and this is orientation.

### Decisions the plan settles — do not re-derive them

**The group keys on the pull request number, never on `github.ref`.** For a pull request `github.ref` is `refs/pull/<n>/merge`, so a ref-keyed group would also group only runs of one PR — but the existing row "no concurrency group in ci.yml is keyed on the ref" (`release-pr-ci.test.mjs`, #1227, 2026-10-03) forbids the string `github.ref` in any group line, and it must stay green unchanged. A `main` push has `github.ref` = `refs/heads/main`; a ref-keyed group would cancel a `main` push run when the next merge lands, which the comment above the block rules out on purpose.

**The release PR keeps an isolated group.** `release.yml` force-pushes `changeset-release/main` on every regeneration. The `validate` job of that branch's `pull_request` run is the one the ruleset counts once a person approves it (2.31.0, PR #3080, 2026-11-06). A grouped run would be cancelled by a regeneration during approval. The exception is `github.head_ref == 'changeset-release/main'` on `pull_request` events. `github.head_ref` is empty on `push` and `workflow_dispatch`, so it can only match inside the `pull_request` arm. Open Question 1 in the plan asks whether the exception is needed; the plan's answer is to keep it, because dropping it risks the run the ruleset counts and keeping it costs one expression arm. State this answer in the PR and tick the box in the plan.

**Expression precedence.** `a && b || c` in an Actions expression returns `b` only when `b` is truthy. `format('pr-{0}', …)` is a non-empty string, so the arms chain safely. Parenthesise the `pull_request && head_ref != …` condition so the arm reads as one test.

**The sprint-branch row stays.** "a pull request run into a sprint branch gets the group of a pull request run into main" asserts the group line never mentions `base_ref`. The new group does not, so the row stays green. Do not edit it.

**`runWasTimedOut` (Open Question 2).** It reads a `cancelled` job that ran 5 minutes or more (`MIN_TIMEOUT_MS`) as a `timeout-minutes` cap, and its own comment records that a hand cancel after 5 minutes already reads as a timeout. Under this change a superseded run is cancelled at any age up to about 25 minutes. Measured by grep on 2026-11-11, the only decision reader of `runWasTimedOut` outside `checks-verdict.ts` goes through `checksFromRuns`, consumed at `packages/domain/src/workflows/agent-loop.ts` (the `'timed-out'` case, line ~1088). `checksFromRuns` checks the remote tip FIRST and ends the wait with `tip-moved` when the tip is no longer the pushed commit, so a run on a superseded head should never reach the timeout reading there. Verify this for every reader that can ask about a head other than the PR's current head — also follow `build-timed-out` in `packages/domain/src/rules/attention.ts` and `packages/domain/src/transitions/build.ts` back to their source. Then do one of two things, and say which in the PR: (a) show by test or by reading that no reader sees a superseded run, and add no code; or (b) make `runWasTimedOut` tell a superseded run from a capped one (for example the run's head SHA against the PR's head) and add the `checks-verdict` row the plan's Done-when table names. Do not widen `MIN_TIMEOUT_MS` to cover this: it already sits above every measured supersession (53–91 s) and below every cap, and a 20-minute supersession falls inside neither guarantee.

**Carried-over rules.** Absent is not false: a run with no `jobs` or no timing never reads as a timeout. Read the exit code of a check, not its emptiness. A gate test is worth believing only after a mutation proves it fails (see Done when).

### Done when

The plan's `## Done when` table is the specification: a `pull_request` run's group keyed on the PR number with `cancel-in-progress: true`; a `push` run's group is `github.run_id`; the release PR's `pull_request` run gets its own group; the no-ref row stays green; and a superseded run does not read as a timeout (Open Question 2's outcome).

Assertions that exist because a naive implementation would pass without them:

- **Mutate each arm of the group and see a row fail.** Replace the PR arm with `github.run_id`, drop the `changeset-release/main` exception, and route a `push` run into the PR arm. Each mutant must turn at least one new row red. A regex that only looks for the substring `github.run_id` passes all three mutants, which is how the old row "isolates every other run" could pass while a main push shared a group.
- **The rows assert on the group expression for each event.** Evaluate or parse the three arms rather than grepping for three words that may sit in the comment instead of the expression (the comment block is part of `preamble(CI)`).
- **A copy of `ci.yml` that groups `main` pushes together is refused.** That is the one failure that cancels real merge validation.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (use `env -u PLOT_REPO_ROOT -u PLOT_UNATTENDED` with Node 26.13.0 on PATH). The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run the `test:e2e` suite locally. Add a changeset for the `plot` package with the description first and the `bumps:` block last, and put `plan: docs/plans/2026-11-09-ci-cancels-superseded-runs.md` in the same block after the description; run `./scripts/check-changeset-packages.sh`. No `.sh` file under `skills/` needs to change; if one does, `scripts/check-shell-lines.sh` requires an equal removal in the same change. Do not commit a rebuilt board bundle.

### Bookkeeping

When the PR is created through `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), append `→ #<number>` to this branch's line under `### Cancel` in the plan's `## Slices` section. Tick or answer both Open Questions in the plan in the same change. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `.github/workflows/ci.yml` (the concurrency block and its comment only), `test/reconcile/release-pr-ci.test.mjs`, `packages/domain/src/rules/checks-verdict.ts` and its test `packages/domain/test/checks-from-runs.test.ts` (only if Open Question 2 needs code), the plan file's Open Questions and slice annotation, and one changeset. `release.yml` stays untouched: its own `concurrency` blocks (`cancel-in-progress: false`) are a different mechanism. No other plan's slice touches `ci.yml`'s concurrency block as of 2026-11-11; verify with `git log origin/main -- .github/workflows/ci.yml` before pushing.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
