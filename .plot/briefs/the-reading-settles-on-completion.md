## Implementation brief — main-merges-more-than-one-pr-per-ci-run (wave 2: The reading settles on completion)

- **Plan (canonical):** docs/plans/2026-11-17-main-merges-more-than-one-pr-per-ci-run.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3503 merged
- **Branch:** `feature/the-reading-settles-on-completion` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** `Review: pr` — the slice PR carries `plot/review`; a push that moves the head voids it, so batch fixes into one push

This is wave 2 of 4 and waits on nothing. Wave 1 (`the-settle-ignores-plot-commits`) merged as #3508, so `settledPast` is on main and this slice does not touch it. Wave 3 (`a-red-main-names-its-pr`) is independent of this one, and wave 4 (`merges-stack-two-deep`) is deferred on the throughput measure that follows this wave.

### What to build

A merge waits until the reading on main's tip is green, and the reading sees a settle late for two reasons. Measured 2026-11-17: main's CI takes about 21 min (`gates` 1.2, `checks` 7.5, `census-*` 12.2). `validate`, the one required check, needs no `census-*` job, so it ends about 5 min before the `CI` workflow run does, but the reading folds the whole `CI` run. And `REASK_MS` = 5 min (`packages/fleet/src/shared/default-branch-refresh.ts:29`) asks a pending head only every 5 min, so a settle is seen up to 5 min after it happens. Your change is the fix when a pending head is asked again at the time its run is expected to end, and the reading of this repository folds `validate` alone.

Build two things on what exists:

1. **An expected-end re-ask.** `reaskIntervalMs` and `reaskDue` (`default-branch-refresh.ts:31-62`) decide when a held reading is asked again. For a `pending` head inside `Checks wait`, the interval becomes the time left until the run's expected end, from the run's start time and the duration of the last green runs of the same jobs. `REASK_MS` stays the upper bound, as the plan states. `reaskDue` is called from `refreshDefaultBranch` and from `refreshOnChange` (`:285`), so both paths must use the new interval, or one skips a reading the other asks for.
2. **A job form for `Default branch checks`.** A value `<workflow>/<job>` such as `CI/validate` folds only that job of that workflow. A bare name such as `CI` keeps its meaning, the whole workflow run, so every existing value stays valid. This repository's `CLAUDE.md` then declares `CI/validate`. A job name the CI system cannot read as a job matches no run, `unmatchedChecks` reports it, and the reading folds it as `unknown`, never green.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The reading does not reuse `Merge checks`.** The alternative is to fold the same `validate` the PR rollup reads. It fails for three reasons. `Merge checks` is read from the host's check rollup on a PR head (`pr.checkRuns`, through `mergeChecksVerdict`), while the reading is the CI connector's answer for a main commit (`build.runsForSha`, filtered by `declaredRuns`), and the Layering Rule keeps the two connectors apart. A repository may require different checks on a PR than on main. And the job form keeps every existing `Default branch checks` value valid. This repository already declares `Merge checks: validate` and `Default branch checks: CI`; they stay two keys.

**`REASK_MS` stays as the upper bound.** The expected end only shortens the interval. A head with no known expected end, or one whose expected end already passed, is asked at `REASK_MS` as today. The existing cadence tests (`packages/fleet/test/unit/default-branch-refresh.test.ts:219-237`, 12 asks in the first hour inside `Checks wait`) must pass unchanged for that case.

**A `census-*` failure no longer turns the reading red, and that is intended.** `census` is not a required check in ruleset 24412719. Do not add `census` back through a second declared name.

**The rules carried over from related work:** absent is not green. A job name that matches no job, a jobs read that fails and a duration that cannot be read all fold to `unknown` or fall back to `REASK_MS`, and none reads as green or as "ends now". Measured 2026-08-27, an empty result read as "no PRs" and refused four fully merged plans; the same rule applies to an empty jobs list. A derived reading is not persisted (`Answers, never verdicts` in CLAUDE.md), so write the expected end into no state file; derive it per refresh from what the host answered.

### Traps this brief found in the code

**Every caller folds through `declaredRuns`, and they must agree.** `declaredRuns(runs, checks)` is called by the refresh (`default-branch-refresh.ts:145`, `:334`), `revert-start-world.ts:138`, `revert-start.ts:346`, `rules/repair-start.ts:35,66` and `workflows/merge.ts:508`. If only the refresh learns the job form, the reading says green on `CI/validate` while the revert's second read, or the repair start, folds the whole `CI` run and says red on a `census-*` failure. Two readings of one commit then disagree, which is the failure the plan exists to remove. Choose a shape where one function answers for all of them. One shape that does so: the jobs become `WorkflowShaRun` entries whose `workflow` is `CI/validate`, so `declaredRuns`, `unmatchedChecks` and `foldRuns` work unchanged. Whatever you choose, assert in a unit test that the refresh and one other caller fold the same runs to the same state.

**`registryd-main.ts:3986` reads the first entry as a bare workflow name.** `requiredWorkflow: checkNamesOf(...)[0] ?? 'CI'` feeds `requiredChecks` (`rules/release-prepare.ts:189-197`), which tests `run.workflow === workflow` against the release PR's checks. With `Default branch checks: CI/validate` that comparison matches nothing, `requiredChecks` answers `not-green`, and release preparation never reaches `ready`. A test on the refresh alone does not catch it. Fix the consumer to take the workflow part, or prove it already does, and assert it with the value `CI/validate`.

**A Jenkins job path already contains `/`.** `build-jenkins.ts` fills `WorkflowShaRun.workflow` with the job path, such as `folder/job`. A rule that splits every declared name at its last `/` reads a whole Jenkins job path as workflow plus job and matches nothing. Match the declared name as a whole workflow name first, and read it as `<workflow>/<job>` only where the CI system is GitHub Actions (`build.system() === 'github-actions'`). Assert a Jenkins-shaped name with a slash still matches as a whole.

**No existing read returns a successful run's jobs.** `ShaRun.jobs` (`entities/build.ts:180`) is filled only for a run that concluded `failure` or `cancelled`, from `gh run view`; `GhRun` carries `databaseId` (`rules/runs-for-sha.ts`) but `WorkflowShaRun` drops it, and `githubRuns.list` (`adapters/host/github-runs.ts`) reads no jobs. The plan prices the read at one `GET /actions/runs/{id}/jobs` per declared run asked. Add it on the connector side of the port (`build-actions.ts`), the only place that may reach GitHub, and keep the domain pure over values. The refresh's settle walk asks up to `ANCESTOR_ASKS_MAX` = 5 commits per refresh, so count the jobs reads in that case and say the number in the PR. If the in-process client (`api`) is absent, the shell route is the only reader; `plot-host.sh` growth is paid for under `scripts/check-shell-lines.sh`, so answer `unknown` on that route and report it instead of growing the script.

**No existing read returns a duration.** `BuildRun` and `ShaRun` carry `startedAt` and no end. The job entries `startedAt` and `completedAt` exist on `ShaRun.jobs`. The last green runs of the same jobs come from `build.runs(branch, limit)` plus a jobs read, or from the jobs of an earlier answer the refresh already holds. Pick the source that adds the fewest host calls per tick, state the count, and fall back to `REASK_MS` where the duration is unread. If no source adds fewer than one host call per pending refresh, report it before building around it.

### Done when

The plan's `Done when` entry for this slice is the specification: the refresh asks a pending head again at its expected end, and never later than `REASK_MS`, asserted in a unit test; `CI/validate` folds only the `validate` job, a bare `CI` folds the whole run as today, and an unreadable job name reads `unknown` and is reported by `unmatchedChecks`, each asserted in a unit test; this repository's `Default branch checks` reads `CI/validate`.

Assertions a naive implementation would pass without:

- A `census-*` job that failed beside a green `validate` reads `green` under `CI/validate` and `red` under `CI`. It catches a job form that folds the whole run.
- A pending head whose expected end lies beyond `REASK_MS` is asked at `REASK_MS`, not later. It catches the expected end replacing the upper bound.
- An expected end that already passed does not make the refresh ask on every tick. Set a floor, state it, and assert it. It catches a hot loop against the host while a run overruns.
- A failed jobs read, an empty jobs list and an unread duration each read `unknown` or fall back to `REASK_MS`, and never `green`. It catches fail-open on an unread input.
- The refresh and a second caller of `declaredRuns` fold the same runs to the same state for `CI/validate`. It catches the split-readings trap above.
- `requiredWorkflow` with `CI/validate` still matches the release PR's `CI` runs. It catches the release-prepare trap above.
- A Jenkins-shaped name containing `/` matches as a whole name. It catches the split-at-slash trap above.
- A green head and a red head keep today's cadence (one ask per half `Checks wait`, `reaskIntervalMs`); only a pending head inside `Checks wait` gets the expected end. It catches the new interval leaking into the paths that keep `askedAt` inside `Checks wait`.
- Mutation check: make the expected-end interval return `REASK_MS` unconditionally and confirm the expected-end tests fail. Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and do not run `test:e2e` locally. The domain package follows its own style: arrow functions (`export const f = (…) => …`), and TSDoc that states what an export does, takes, returns and how it fails, with the reasoning left to the commit message. A function you write is an arrow in the fleet package too. Use `Slice` and `Agent` vocabulary, never new `Wave` names in code. Do not commit a rebuilt board bundle (`check-no-bundle-diff.sh` refuses it; `main` builds its own).

Add a changeset in the package `plot`, description first and the `plan:` line inside the trailing comment block, using the plan's second Changelog line as the description (`The default-branch reading asks a pending head again when its CI run is expected to end, …`). Document the job form in the `Default branch checks` entry of `skills/plot/scripts/plot-config.sh` (the comment block at `:236`): names match a run's workflow name, and `<workflow>/<job>` matches one job. Editing the comment is not a shell-line change, but run `scripts/check-shell-lines.sh pr` to see it. If you touch a `SKILL.md`, add the `skills:` bump for it. Change the `Default branch checks` line in `CLAUDE.md` to `CI/validate`, then run `./scripts/check-agents-md.sh --write` so the `AGENTS.md` mirror follows; CI refuses a mirror that differs.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice is TypeScript only and should add no shell. If you touch a `.sh` file, pay for any growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

After this slice merges, a person reads the plan's throughput measure (Notes › Measure): merges per hour over a working day with at least 6 PRs ready. Under 3 per hour lifts the `deferred:` marker on wave 4. That is not a duty of this branch; do not edit the marker.

### Scope guard

This branch owns: `packages/fleet/src/shared/default-branch-refresh.ts` (`REASK_MS`, `reaskIntervalMs`, `reaskDue`, and the fold at `:145` and `:334`), `packages/domain/src/rules/default-branch.ts` (`declaredRuns`, `unmatchedChecks`, `checkNamesOf`), the connector read in `packages/domain/src/adapters/build/build-actions.ts` and `build-fixture.ts`, the `requiredWorkflow` line in `packages/fleet/src/server/entry/registryd-main.ts`, the callers of `declaredRuns` listed above where they need the shared fold, `CLAUDE.md`/`AGENTS.md`, the `plot-config.sh` comment, and their tests.

Other slices in flight (checked on `origin/main` at dispatch, none with a branch or brief yet):

- `feature/a-red-main-names-its-pr` owns `rules/repair.ts`, `revert-start.ts` and `writeRepairRecord` in `default-branch-refresh.ts` (`:202-218`). It lives in the file you edit. Do not change `writeRepairRecord`, and do not change `candidatesFromLine`. Keep your edits to the interval functions and the two fold sites, so the two branches merge without a conflict.
- `feature/merges-stack-two-deep` is deferred. It adds `stack-full` and `paths-overlap`; this slice adds no refusal names, and the board needs no change from it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
