## Implementation brief — main-ci-runs-only-for-the-newest-head (slice 2: Bookkeeping Push Selection)

- **Plan (canonical):** docs/plans/2026-11-21-main-ci-runs-only-for-the-newest-head.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3638 merged
- **Branch:** `infra/a-bookkeeping-push-runs-only-the-gates` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review, `Review: pr`)

Slice 1 (`infra/main-ci-cancels-an-older-head`, #3654) merged 2026-11-22. This slice waited on it and nothing waits on this one.

### What to build

A push to `main` runs every one of 11 CI jobs, although 53 of 60 pushes measured 2026-11-21 (06:00–11:00 UTC) change only plan, sprint, index and brief files. Make such a push run the jobs a plan-only pull request runs, and keep every other push at the full run.

- `pushSelectionBase({ greenHead, firstParent })` in `packages/domain/src/rules/push-selection-base.ts` answers `{ base }` or `{ every: 'api-failed' | 'no-green-run' | 'not-on-line' }`. `greenHead` is the head of the newest successful `CI` push run on `main` (`null` where the call failed, `''` where none exists). `firstParent` is `git rev-list --first-parent -n 50 HEAD`. The base must equal one list entry by equality, never by an ancestry test.
- `plot-local-checks.mjs --push-base <green.json> <first-parent.txt>` is a new mode that prints `base=<sha>` or `every=<reason>`. Name it in the script's row in `skills/plot/scripts/README.md`.
- `ciSelection` (`packages/domain/src/rules/local-checks.ts`) gains `planDataOnly: boolean`: true where at least one non-generated path changed and `syncPathVerdict(changed, syncPathSet(keys))` is `ok`. The entry `packages/board/src/server/entry/local-checks.ts` reads the keys it does not read yet.
- `ci.yml`: the `select` job's install, build, base and ask steps also run on `push`; the push diff is `git diff --name-only --no-renames <base> HEAD`; the push checkout gets `fetch-depth: 51`; the guard at the event check becomes three cases (pull request as today; push maps as a pull request only with a base and `planDataOnly: true`, otherwise every job; every other event every job); `select` gains the output `push_base`; `gates`' two push-mode steps measure from `needs.select.outputs.push_base` where set, else `github.event.before`; the block comment names the exception and its base.

### Decisions the plan settles — do not re-derive them

- **No `paths-ignore` on the push trigger.** A head with no run reads `unknown`; `advanceSettled` keeps the old settled part; only a person after `Checks wait` passes it, never fleetd. A skipped workflow would stop every fleetd merge after each bookkeeping push. Keep a run on every push and make it short.
- **The base is the newest green push head, not `HEAD^1` and not `github.event.before`.** With slice 1 an older head's pending run is cancelled, so the newest run must cover every commit since the last head CI proved. A narrowed run's base was itself green, so the chain holds.
- **The decision lives in the domain, the shell only routes.** Same split `ciReuse` uses (`ci-reuse.ts`, `plot-ci-reuse.mjs`). An `$event` argument in `scripts/ci-job-map.jq` was rejected: it puts a decision into a jq program with no unit tests and two callers, and the reuse read near `ci.yml:398` would depend on a default it does not pass. **`scripts/ci-job-map.jq` does not change.**
- **`.plot/panels/` stays out of `syncPathSet`** (operator decision 2026-11-21). The set has three readers: `planDataOnly`, `settledPast` (`auto-merge.ts`) and the sync-PR gate. A panel-only push runs every job. `planDataOnly` answers false for it although `ciSelection` treats it as plan data for a pull request; pin both meanings in rows.
- **`.plot/hold` gets the full run.** It is in `FIXED_SYNC_PATHS`, so `planDataOnly` is true, but it is not `.md`, lands in `untested`, and `$wide` selects every job. That fails safe; pin it with a row, do not special-case it.
- **A skipped job passes `validate`.** The run concludes `success`, `CI/validate` reads `success`, and the settled part advances. No domain reading changes.
- **A narrowed run (9.3–17.3 min) does not keep pace with a 1.9-min push gap.** The 5-commit `settledPast` cover may not hold, so a short `merge-in-flight` / `default-branch-unsettled` hold remains. The plan accepts it; do not promise none.
- **Bundle-only ranges keep the full run.** Generated paths are not plan data.
- Carried rules: absent is not false — a failed API call answers `api-failed` and selects every job, never a narrowed run; read the exit code, not the emptiness.

### Done when

The plan's `## Done when` list and its slice 2 test list are the specification. Assertions that exist because a naive implementation would pass without them:

- `push-selection-base.test.ts`: a green head at index 0 answers `{ base: HEAD }`; a head absent from the list, and a 50-entry list that does not hold it, answer `not-on-line`. Catches an ancestry test or an off-by-one on the depth.
- `ci-selection.test.ts`: `planDataOnly` false for `.plot/panels/`, for code beside plan files, for a `..` path, for an empty change, for generated bundles only. Catches an "all paths look like docs" shortcut.
- `ci-selection-jobs.test.mjs`: a push with `planDataOnly` false or no field, an `every=` answer, a failed ask and a `.plot/hold` push each select every job. Catches a narrowed run on missing data. The existing "the read stays inside its budget" row (non-null `jobMap`) must pass unchanged — it proves the reuse read still compiles against the unchanged jq.
- Row that `gates` measures both push-mode steps from `push_base`, and that the push checkout carries `fetch-depth: 51`.

Plus: a changeset for `plot` that names the plan, description first and the `plan:` / `bumps:` comment last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI and a failure there comes back as a correction. Run no full suite and not `test:e2e`. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this slice should add none, and any `.sh` growth is paid for in the same change. Do not commit generated bundles (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`) and append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Post-merge, the operator records in the delivery that a bookkeeping-only push ran 5–6 of 11 jobs and concluded `success`.

### Scope guard

This branch owns: `packages/domain/src/rules/push-selection-base.ts`, `rules/local-checks.ts` (`ciSelection`), `packages/board/src/server/entry/local-checks.ts`, the `select` and `gates` jobs and the comment block of `.github/workflows/ci.yml`, `test/reconcile/ci-selection-jobs.test.mjs`, the two domain tests above, the README row, and a changeset. Leave alone: `scripts/ci-job-map.jq`, the concurrency group slice 1 changed, `syncPathSet` membership, and the repair/revert code. Open overlap: #3637 adds a gate step to `ci.yml` and touches neither `select` nor the concurrency block; the plan `2026-11-21-reports-name-their-cause-and-ci-selects-their-tests` (#3149) changes what a plan-only change selects (adds `helper-contracts`) — whichever lands second rebases, and the extra job is intended.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
