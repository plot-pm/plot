## Implementation brief — main-ci-runs-only-for-the-newest-head (wave 1: Main Concurrency Group)

- **Plan (canonical):** docs/plans/2026-11-21-main-ci-runs-only-for-the-newest-head.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3638 merged
- **Branch:** `infra/main-ci-cancels-an-older-head` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (`Review: pr`)

`infra/a-bookkeeping-push-runs-only-the-gates` (wave 2) waits on this branch. It relies on the `main-push` group and on the cancelled-run readings this slice adds.

### What to build

On 2026-11-21 between 06:00 and 11:00 UTC, 22 `main` CI runs queued at once and a person cancelled 21 by hand. fleetd's default-branch reading stayed settled on `b21961602f02` from about 08:28 to 11:30, so PR #3619 and others waited 3 h with green CI. Every `main` push has its own concurrency group (`github.run_id`, `.github/workflows/ci.yml:78-80`), so no run replaces an older one.

This slice puts a first `main` push attempt into one group, `main-push`, with `cancel-in-progress: false`. One run finishes, a newer push replaces the pending run, and the newest head runs next. That change makes cancelled and waiting runs routine, so three readers must learn them:

- The head fold of the default-branch refresh reads a waiting run as `pending`, not `unknown`.
- The revert picker skips a cancelled bookkeeping commit.
- The revert picker names a cancelled code commit as `cancelledSha` and ends the episode at `exhausted`.

The plan's Design › Approach › Slice 1 is canonical and names every file and line. This brief carries the decisions that are settled.

### Decisions the plan settles — do not re-derive them

- **`cancel-in-progress: false` for the `main` push group, not `true`.** The operator decided this on 2026-11-21 against the request's `true`. Median push gap is 1.9 min and a full run takes at least 19.9 min, so with `true` a head concludes only in a quiet gap longer than one run. That gap occurred twice in 5 h. `build-bundles.yml` uses `true` because an older build must not overwrite a newer one; that reason does not apply to a test run. The expression is `${{ github.event_name != 'push' }}`.
- **A re-run keeps its own group.** The arm is `(github.event_name == 'push' && github.run_attempt == '1') && 'main-push'`, before `github.run_id`. fleetd re-runs CI once per red episode (`rerunFailed` in `repair-start.ts:137`, `rerunAll` in `revert-start.ts:257`). A re-run inside `main-push` would replace the newest head's pending run, or a later push would cancel the re-run, which `rerunSettledOf` reads as `pending` with no bound. `github.run_attempt` is a string, and the test evaluator maps `==` to `===`, so the test contexts carry `'1'`.
- **A waiting run reads `pending`, not `unknown`.** A run that waits in the group has created no jobs. `build-actions.ts:84-108` adds a `CI/validate` entry only for a job that exists, and `declaredRuns` keeps only that name. Today's fold reads `unknown` for as long as the run waits, and `unknownHeadBound` (`merge.ts:200-210`) then passes a person's `plot-ask.mjs merge` after `Checks wait` over a head no run has tested. `candidateRunsOf(runs, checks, jobForm)` takes every run of the commit, not `declaredRuns(...)`, and reads the run-level `CI` row. `declaredRuns` stays for `timing.observe`, `failingRunsOf` and the ancestor walk, because `ancestorStep` passes over `pending` and `unknown` alike.
- **The picker skips a cancelled bookkeeping commit and names a cancelled code commit.** `redMainPicker` (`repair.ts:109-121`) answers `hold` for the oldest candidate that is neither green nor red, so a cancelled candidate holds the episode forever and it never reaches `exhausted`, where `repair-pr` is accepted. A candidate with `runs: 'cancelled'` and `plotDataOnly: true` is skipped like a green one; the tick's read loop (`revert-start.ts:202`) must continue past it too. With `plotDataOnly: false` the picker answers `{ cancelled: <sha> }`, and no later PR may be named in its place because its change is in every later candidate. `redMainStep` answers `exhausted` for that answer past the bound, as it does for `unknown`.
- **`plotDataOnly` uses `syncPathSet` and excludes `.plot/panels/`.** The operator decided this on 2026-11-21. The set has three readers (`settledPast`, the sync-PR gate and slice 2's `planDataOnly`). Adding the path would widen all three trusts to a review product to save one full run in 60. `revertWorldOf` reads `Active index` and `Delivered index` beside the two directories it already reads, with `DEFAULT_RELEASE_DIR` as `plotPathSetOf` uses it (`auto-merge.ts:314-329`), and no generated bundle.
- **The cost is stated, not hidden.** A cancelled bookkeeping commit that itself turned `validate` red makes the picker name the next red PR, fleetd reverts a PR that did not break `main`, and the episode ends at `exhausted`. The plan's Changelog says so; do not "fix" it by treating a cancelled commit as red.
- **`cancelledSha` is optional and `REPAIR_RECORD_VERSION` stays 1.** `RepairRecordSchema` is `.strict()`, so a reader built before this slice reads a record with the field as no record. fleetd and `plot-ask.mjs` must run from one build. The field is written only at `exhausted`.
- **`jobForm` reaches the revert world through `RevertWorldOptions`.** `registryd-main.ts:4141` sets it to `ci.system() === 'github-actions'`, as `:4088` derives it.
- **Rules this repo keeps re-learning:** absent is not false, and an empty list reads `unknown`, never `red` (`foldRuns`). `advanceSettled` moves only on `red` or `green`. A cancelled run never settles anything.

### Done when

The plan's `## Slices` entry for this branch and the Tests list in Design › Approach › Slice 1 are the specification. Assertions that exist because a naive implementation passes without them:

- `release-pr-ci.test.mjs`: a re-run row with `github.run_attempt` `'2'` that gets its own group. Without it a group of `main-push` for every push also passes.
- `release-pr-ci.test.mjs`: a row that evaluates the `cancel-in-progress` expression itself. `concurrencyGroup` reads only the `group:` line, so a literal `true` would pass the group rows.
- `default-branch-refresh.test.ts`: a head with a `CI` run `pending` and no `CI/validate` entry stores `head: 'pending'`; a concluded-`cancelled` one stores `unknown`. This catches the fold that still reads `declaredRuns`.
- `workflows-merge.test.ts`: a person's merge past a `pending` head for longer than `Checks wait` refuses `default-branch-unsettled`.
- `revert-start-world.test.ts` (new): against a fake `BuildPort`, it proves the wiring of `candidate(commit).runs` and `plotDataOnly`, because `revert-start.test.ts` fakes the whole `candidate` and cannot see it.
- `revert-start.test.ts`: past the bound with a cancelled code candidate, the record carries `cancelledSha` and the notification names its 12 hex. With a cancelled bookkeeping candidate before a red one, the tick reverts the red one's PR.

Plus: a changeset for `plot` that names the plan, description first and `bumps:` block last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and not `test:e2e`. The slice touches `ci.yml` and TypeScript, not `.sh` files, so `scripts/check-shell-lines.sh` should see no growth; if a shell line is added, remove an equal number elsewhere in the same change. Commit no generated bundle (`scripts/check-no-bundle-diff.sh`).

The GitHub behaviour of the group cannot be tested in the repository. The plan assigns a post-merge check to the operator (three pushes during one run; the first re-run's own `ci-<run_id>` group). Do not try to prove it in the PR.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the group and the comment block in `.github/workflows/ci.yml` (`:57-80`), `packages/domain/src/rules/default-branch.ts`, `rules/repair.ts`, `entities/repair-record.ts`, `packages/fleet/src/shared/default-branch-refresh.ts`, `revert-start.ts`, `revert-start-world.ts`, `packages/fleet/src/server/entry/registryd-main.ts` (the `jobForm` line), and their tests.

Not in this branch: `ciSelection`, `planDataOnly`, `pushSelectionBase`, the `select` job's push arm, `scripts/ci-job-map.jq` and the gate ranges. All of that is wave 2. Open PR #3624 (`bug/merge-reads-the-main-checkouts-state`) changes `revert-start-world.ts:110-116`; this slice changes `:31-47` and `:131-139`, so a rebase is trivial. PR #3637 adds a gate step to `ci.yml` at `:2056` and touches neither the concurrency block nor `select`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
