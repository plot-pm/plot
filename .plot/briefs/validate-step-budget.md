## Implementation brief — validate-runs-at-86-of-its (wave 1: Measure and bound)

- **Plan (canonical):** `docs/plans/2026-10-19-validate-runs-at-86-of-its.md` on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2124 merged
- **Branch:** `infra/validate-step-budget` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

`infra/a-timeout-reads-as-a-timeout` (wave 2, "Report") waits on this branch. Nothing waits on wave 2.

### What to build

Bring the `validate` job's wall time under 60 % of its 25-minute cap at p95, and decide the number from a measurement of the last 30 runs. Edit `.github/workflows/ci.yml` only; the plan's slice 2 owns every change to `plot-host.sh` and `checks-verdict.ts`.

The failure this fixes, measured 2026-10-19 (#2121): three PR runs of `validate` ended `cancelled` or `failure` and the same heads passed on re-run. Run 39276878253 attempt 2 on #2108 had every step `success` and a duration of 25 min 2 s, because GitHub reports a job that reaches `timeout-minutes: 25` as `cancelled`. Two steps hold 78 % of the 23 min 42 s step sum: *Board integration tests* 574 s and *Helper contract tests* 538 s. The comment above the cap (`ci.yml:187-193`) still says a green run takes about 7 minutes, measured 2026-08-19. Update that comment with the new distribution.

### The decisions the plan settles — do not re-derive them

**Measure before choosing.** One run is not a distribution. Read the step durations of the last 30 `validate` runs (`gh api repos/plot-pm/plot/actions/runs/<id>/jobs`, field `steps[].started_at` / `completed_at`), on `main` and on PRs, and write median, p95 and maximum per step into the plan's Design section. The target is p95 ≤ 15 minutes (60 % of 25). Raise the cap only if a split does not reach that.

**The two options are a split and a step bound, and they are not exclusive.** Splitting *Board integration* and *Helper contract* into jobs that run in parallel with `validate` cuts wall time. A `timeout-minutes` on a slow step makes that step fail under its own name. Both steps already carry one (`ci.yml:316` is 12, `ci.yml:1363` is 15), and neither fired in run 39276878253 because 538 s and 574 s sit under them. The job cap fired because the sum of steps did. A step bound alone therefore cannot fix this failure.

**The branch ruleset names `validate` only.** Measured 2026-10-19: ruleset 24412719 requires the contexts `validate` and `plot/review`. A new job is not a required check, so a split job that fails does not block a merge. Either keep the check in `validate`'s required set by adding the new job names to the ruleset (a settings change a person makes; report it, do not make it), or give the new job a `needs:` edge that `validate` waits on. Name the choice in the PR description.

**`corpus` is the precedent for a sibling job** (`ci.yml:103`): its own `runs-on`, its own ceiling set from a measurement (15 minutes against 42 s), and its dispatch guard as the first step. A split job copies that guard, because a checkout ahead of it clones an unpinned ref before anything refuses.

**Do not shard or weaken the helper contract suite.** The comment at `ci.yml:286-314` records that `dispatch.test.mjs` takes 6 min 5 s alone and that two earlier failures were contention (`spawnSync bash ETIMEDOUT` against a 30 s bound), repaired by bounding concurrency and never by weakening an assertion. A split moves the suite to another runner and keeps every test.

**Rules carried over unchanged.** A new `ci.yml` gate step keeps the repo's step-comment style (what it measured, with the date). Do not commit a generated board bundle: `scripts/check-no-bundle-diff.sh` refuses it.

### Done when

The plan has no `## Done when` list. The slice's own line is the specification: *measure the last 30 runs, then split or bound the slow steps so p95 stays at or below 60 % of the cap.* The assertions a naive implementation would pass without:

- **The distribution is in the plan.** Median, p95 and maximum per step, from 30 runs. Without it the 60 % target is a guess and a re-run of the same flake cannot be told from a fix.
- **The p95 is measured after the change, not predicted.** Push the branch, read the step durations of its own CI runs, and state the number in the PR description. A split that moves 538 s to another job and leaves `validate` at 21 minutes passes review and fixes nothing.
- **The required-check answer is stated.** The PR description says whether each new job gates a merge, and what the ruleset must change if it does not.
- **The open questions are closed.** The three plan Open Questions get an answer in the plan. The jobs-API question (do `steps[].conclusion` or annotations expose a timeout) and the concurrency-cancel question feed wave 2, so record what the data shows.

Plus: add a changeset (`'plot': patch`, description first, `bumps:` block last — `./scripts/check-changeset-packages.sh` refuses the other order). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file, and if it does, remove shell elsewhere in the same change.

### Bookkeeping

When the PR opens, run `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`; add `--draft` while the work moves) and append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `.github/workflows/ci.yml`, the plan's Design and Open Questions sections, and a changeset. It does not touch `skills/plot/scripts/plot-host.sh` (line 4651 reads `cancelled`) or `packages/domain/src/rules/checks-verdict.ts` (lines 141–162, 254): those are `infra/a-timeout-reads-as-a-timeout`, which waits on this branch. No other open PR touches `ci.yml` and no other `infra/*` branch exists on origin (checked 2026-10-19).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
