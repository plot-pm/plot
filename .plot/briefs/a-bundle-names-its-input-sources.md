## Implementation brief — a-launcher-change-selects-its-tests (wave 1: Bundle Inputs)

- **Plan (canonical):** `docs/plans/2026-11-27-a-launcher-change-selects-its-tests.md` on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-bundle-names-its-input-sources` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per the repo's `Review: pr` convention

Wave 2 (`bug/a-launcher-names-the-bundle-it-runs`) waits on this branch. It reads the map this branch writes and adds the launcher step. Build nothing of `launcherBundles` here.

### What to build

#3653 changed `packages/board/src/server/entry/approve.ts` and `packages/domain/src/workflows/approve.ts` and passed its PR CI. The select step chose 14 contract test files and left out `test/reconcile/approve-batch.test.mjs`, which runs the approve bundle through its launcher. Main went red on `approve-batch.test.mjs:224` and `:283`. The bundles were fresh; the selection was the gap.

Today `searchTerms` (`packages/domain/src/rules/local-checks.ts:156`) adds a bundle's basename only where the changed path is that bundle's entry (`pair.entry === path`). A path the bundle merely imports, such as `workflows/approve.ts`, adds no bundle name.

Build this:

1. `packages/board/build.mjs` asks esbuild for a metafile (`metafile: true`) on each shipped bundle's build and writes `packages/board/dist/bundle-inputs.json`, shape `{ shipped: string, inputs: string[] }[]`, repository-relative paths, sorted by `shipped`. `build.mjs` has 74 `esbuild.build` calls, so collect the inputs in one helper rather than editing each call by hand where you can.
2. `searchTerms` takes the input map in place of `BOARD_BUNDLE_ENTRIES`. A changed path adds the basename of every bundle whose `inputs` hold it. Keep the existing `.js` form of a TypeScript basename.
3. A missing or unparseable map falls back to the entry pairs (`BOARD_BUNDLE_ENTRIES`) and the selection's first output line names the fallback.
4. The read sites are `packages/board/src/server/entry/local-checks.ts` (lines 303 and 322, CI and local) and the rule in `packages/domain/src/rules/local-checks.ts` (`ciSelection`, `localChecks`, `testsNaming`). The domain takes the map as a value in its readings; the entry reads the file. The domain imports no `node:fs`.

Plan Open Question `question-selection-width` is settled by its recommendation: accept the width. A shared domain module sits in most bundles and selects most contract tests. Do not narrow the rule.

### The decisions the plan settles — do not re-derive them

**The map lives in `dist/`, not in a committed file.** `packages/board/.gitignore:2` ignores `dist/`, so `check-no-bundle-diff.sh` sees nothing new and no PR carries it. A committed `bundles.generated.ts` field would be generated output in every PR diff and a merge-conflict surface; the gate refuses it. Do not add the map to `bundles.generated.ts`.

**The entry pairs stay as the fallback and are not removed.** CI's `select` job builds the bundles before it selects (`.github/workflows/ci.yml:226`), so the map exists there. A local run before `pnpm build:board` has no map; the fallback keeps that run working at the old precision and says so. Removing the pairs would turn a missing build into an empty selection.

**Read the metafile, not the source text.** `build.mjs` already derives the pairs by regex over its own source (line 165), and that regex is why a bundle with a wrapped call or a copy-only bundle needs care. The metafile lists what esbuild actually bundled, including transitive imports; a regex cannot. A copy-only shipped bundle (a fleet artifact) has no esbuild call and gets no map row, as it gets no pair today.

**Rules this repo keeps re-learning:** absent is not false. A missing map reads "ask the fallback", never "no bundle holds this path". Read the parse result, not the emptiness of the output. An empty `inputs` array for a built bundle is a build defect: fail the build on it rather than write it.

### Done when

The plan's `## Done when` is the specification: the slice's `tests:` annotation reads (1) a change to `packages/domain/src/workflows/approve.ts` adds `plot-approve.mjs` to the search terms, (2) a missing map falls back to `BOARD_BUNDLE_ENTRIES` and says so, (3) `git check-ignore` holds the map file.

Assertions a naive implementation passes without:

- **A path held by two bundles adds both basenames.** A "first match wins" loop passes the approve case and misses every shared module.
- **The fallback line names itself.** A silent fallback passes every selection test and hides a CI job that built no map. Assert the first output line, not only the selected tests.
- **An unparseable map and a missing map take the same path.** A `JSON.parse` that throws out of the entry crashes the selection instead of falling back.
- **Input paths are repository-relative with forward slashes.** esbuild reports paths relative to its working directory; a test that compares against `packages/domain/src/workflows/approve.ts` fails if the build runs from `packages/board` and writes `../domain/...`.
- **`git check-ignore packages/board/dist/bundle-inputs.json` exits 0.** Assert it in a contract test, so a `.gitignore` edit that un-ignores `dist/` fails.

Plus: add a changeset (`'@plot-pm/board': patch`, description first, `bumps:` block last, `plan:` line naming the plan inside the block). Do not commit any generated bundle under `skills/plot/scripts/board/`; `check-no-bundle-diff.sh` refuses it. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI and a failure there comes back as a correction. Run no full suite and not `pnpm run test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file; keep it that way.

Domain code is arrow functions (`export const f = (…) => …`) with factual TSDoc and no decision history. The reasoning goes in the commit message.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/build.mjs`, `packages/board/src/server/entry/local-checks.ts`, `packages/domain/src/rules/local-checks.ts` with its tests (`packages/domain/test/local-checks.test.ts`, `test/reconcile/local-checks.test.mjs`), and the changeset. The `select` job in `.github/workflows/ci.yml` already builds before it selects; change it only if a test shows the map absent there.

Not here: `launcherBundles`, the launcher gate, and any edit to a launcher `.sh`. They belong to `bug/a-launcher-names-the-bundle-it-runs`, which waits on this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
