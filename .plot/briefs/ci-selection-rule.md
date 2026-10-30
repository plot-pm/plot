## Implementation brief — ci-runs-what-the-change-touches (wave 1: Selection rule)

- **Plan (canonical):** `docs/plans/2026-10-30-ci-runs-what-the-change-touches.md` on `main`
- **Approved:** 2026-10-30, Jan Wloka, plan-PR #2944 merged
- **Branch:** `feature/ci-selection-rule` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave blocks wave 2, `feature/ci-reads-the-selection`, which calls this wave's bundle from a CI job. Wave 2 cannot start until this branch merges. Waves 3 and 4 are not yours.

### What to build

CI runs every job on every pull request, and `plot-local-checks.mjs` maps changed paths to checks from the `Local checks` config key without CI reading it. Measured 2026-10-30: the last 40 `CI` runs were 4 success and 26 failure, and a green run takes 17 to 20 minutes. Of the last 40 merged PRs, 12 touched only plans, changesets, docs or tests. The local and the CI selection can differ because only one of them exists as a rule.

This branch makes the selection one rule with two readers. The rule already has a start: `packages/domain/src/rules/local-checks.ts` (`localChecks`, `searchTerms`, `parseLocalChecks`), read through the entry `packages/board/src/server/entry/local-checks.ts` and the bundle `skills/plot/scripts/board/plot-local-checks.mjs`. Extend that rule. Do not add a second rule beside it.

Three additions:

1. **The script-to-test map.** A test that runs `plot-host.sh` is selected when `plot-host.sh` changes. Today `references` is read by the caller (`searchTerms` greps test files for a changed path's basename). Move the derivation into a domain rule that reads each test file's own script references, so CI and the local run build the same map.
2. **The always-run set and the corpus trigger as rule output.** The rule names what runs on every change — the `scripts/check-*.sh` gates and the typechecks — and answers `corpus` whenever a changed path is a plan, a sprint file or under `.plot/`. Wave 2 reads these; this wave only makes the rule say them.
3. **A shape wave 2 can read.** The answer lists the selected suites by name, not only commands, so a CI job can write them as outputs. Keep `plot-local-checks.mjs`'s current output and exit codes unchanged for its existing callers.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**One rule, called through a bundle by both readers.** The alternative, a CI step that re-implements the glob matching in shell, is refused: the corpus tier exists because a duplicated rule drifts, and `check-shell-lines.sh` charges the shell it adds. Any `.sh` that remains is a launcher.

**`vitest related` selects TypeScript tests.** It follows the import graph. The plan's open question is which files it cannot see: a test that reads a file by path instead of importing it. Measure that first and write the names into the rule as paths that select their reading test by hand. Do not assume the graph is complete.

**The script-to-test map is derived, not hand-written.** A hand-kept table is a second place a new test must be registered, and an unregistered test is silently never selected. A corpus test holds the derivation, in `packages/domain/corpus/` beside `sprint-score.corpus.test.ts`. On a disagreement between the derivation and what a test actually runs, the branch stops; adjusting either side to make the comparison pass is the forbidden move.

**Measure the indirect case before fixing the rule.** Open question 3: a test that runs a script through another script. `test/reconcile/` holds 185 `*.test.mjs` files at brief time. Count how many reach a script only through another before choosing between a transitive closure and a flat reference; put the number in the commit message.

**Plan data always selects `corpus`.** Measured 2026-10-30: `corpus/eligible.corpus.test.ts` went red on `main` for about 2 h 45 min after a merge made `feature/role-agent-definitions` eligible. Plan data alone can turn `main` red through it, so no path-based test selection may skip it for these paths.

**The full run on `main` stays.** A selection miss costs one revert at most. The rule never drops a suite from the `main` push; that is wave 2's workflow, but the rule must not make it unreachable.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc. Decision history goes in the commit message, not in comments.
- Absent is not false: a path no check reaches is `untested` and reported, never silently passed. `localChecks` already returns it; keep it.
- A generated path selects nothing (`generated`, from `-merge` in `.gitattributes`).
- A command given a relative path after `pnpm --filter … exec` finds no test and exits 0. Keep the absolute-path `root` behaviour.
- Read the exit code, not the emptiness. A selection of zero tests is an answer to report, not a green run.

### Done when

The plan's slice 1 line is the specification: the domain rule maps changed paths to checks, `plot-local-checks.mjs` reads it, and a corpus test holds the script-to-test map. The assertions that exist because a naive implementation passes without them:

- **A changed script selects the test that runs it.** Catches a map built from file names alone: `plot-host.sh` must select `test/reconcile/host.test.mjs`.
- **A new test file is selected with no registration.** Add a fixture test that names a script, change the script, and assert selection. Catches a hand-kept table.
- **A changed plan, sprint or `.plot/` file answers `corpus`.** Catches a rule that only selects by the `Local checks` globs.
- **A changed path that no check reaches stays in `untested`.** Catches a rule that treats "no match" as "nothing to run".
- **`test/reconcile/local-checks.test.mjs` passes unchanged.** Catches a changed output or exit code for the existing caller.

Plus the repo gates: rebuild the board artifact (`pnpm build:board`) to test locally, then restore generated bundles before you push — a PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`). Add one changeset, description first, `bumps:` last (`CLAUDE.md` › Versioning); `@plot-pm/board` for the entry, and a `plot` entry if a script or skill changes. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines: joining statements with `;` or `&&` is not a payment. It stores no number and has no override.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- Write the answers to open questions 3 and 4 (indirect scripts, files `vitest related` cannot see) into the commit message, with the counts. Wave 2 reads them.

### Scope guard

This branch owns:

- `packages/domain/src/rules/local-checks.ts`, `local-checks-run.ts` and any new file beside them in `packages/domain/src/rules/`, with their tests under `packages/domain/test/`
- `packages/domain/corpus/` — one new corpus test for the script-to-test map
- `packages/board/src/server/entry/local-checks.ts` and its artifact `skills/plot/scripts/board/plot-local-checks.mjs` (rebuilt locally only, never committed)
- `test/reconcile/local-checks.test.mjs` — new cases only; existing cases stay unchanged
- one `.changeset/*.md`

Not this branch: `.github/workflows/ci.yml` (wave 2), the corpus scan's token handling (wave 3), `plot-ask.mjs merge` (wave 4), and the `Local checks` key's syntax, which stays as it is.

Other branches in flight, checked 2026-10-30 at brief time: no remote branch matches `feature/ci-*`, `feature/corpus-reads*` or `feature/ask-merge*`. The other three branches of this plan are not started.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
