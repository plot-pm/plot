# PR CI selects the contracts that run a changed bundle

> CI's test selection follows a changed source through every bundle built from it and every shell launcher that runs that bundle, so a contract test that reaches a change only through a launcher runs on the pull request.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged

## Changelog

- A pull request that changes a module bundled into a shipped `.mjs` now runs every contract test that runs that bundle, directly or through its shell launcher. #3653 passed its CI and turned main red because the one test that reached its change was not selected.

<!-- Board impact: none. The change is in the test selection rule and the board build's unversioned output. -->

## Motivation

#3653 changed `packages/board/src/server/entry/approve.ts` and `packages/domain/src/workflows/approve.ts`, among 14 files. Its PR CI run passed ([45145289167](https://github.com/plot-pm/plot/actions/runs/45145289167)). That run's `helper-contracts` job ran `pnpm run build:board` first and then "Selected 14 contract test files"; `test/reconcile/approve-batch.test.mjs` was not one of them. The PR merged at 09:36 UTC on 2026-11-23 as `3564e21bc`. Main's run on that commit ([45148543795](https://github.com/plot-pm/plot/actions/runs/45148543795)) failed `approve-batch.test.mjs:224` and `:283`, and so did the run on the next bundle build `855b7f19c` ([45150688481](https://github.com/plot-pm/plot/actions/runs/45150688481)). #3685 repaired main at 10:52 UTC as `5b05a4236` and changed only that test file.

The PR's CI built its bundles from its own source; stale committed bundles were not the cause. The cause is selection. `approve-batch.test.mjs` runs the approve launcher (`skills/plot/scripts/plot-approve.sh`, test line 207), and the launcher's line 7 runs `board/plot-approve.mjs`, which is built from `entry/approve.ts` (`packages/board/src/contract/bundles.generated.ts:149`). `searchTerms` (`packages/domain/src/rules/local-checks.ts:156`) adds a bundle's name only where the changed path is the bundle's entry itself (`62b19d26c`, 2026-11-23, after #3653). Today the same change selects tests that name `plot-approve.mjs`, and `approve-batch.test.mjs` names it 0 times. A change to `workflows/approve.ts`, which the bundle imports, adds no bundle name at all.

## Design

### Approach

- **The build names each bundle's inputs.** `packages/board/build.mjs` asks esbuild for a metafile per shipped bundle and writes `packages/board/dist/bundle-inputs.json` (`{ shipped, inputs: string[] }[]`, repository-relative). `dist/` is ignored by git (`packages/board/.gitignore:2`), so `check-no-bundle-diff.sh` sees nothing new and no PR commits it.
- **A changed source names every bundle that holds it.** `searchTerms` takes the input map in place of `BOARD_BUNDLE_ENTRIES`. A changed path adds the basename of every bundle whose inputs hold it. A missing or unparseable map falls back to the entry pairs, as now, and the selection's first line names the fallback.
- **A launcher names the bundle it runs.** A new rule, `launcherBundles(scripts)`, reads each shipped `skills/**/*.sh` for `bundle="$script_dir/board/<name>.mjs"` and answers the launcher's basename for each bundle. A selected bundle name adds its launchers' basenames as terms, so a test that runs the approve launcher is selected by a change to `workflows/approve.ts`.
- **The select job and the local checks read one rule.** CI's `select` job already builds the bundles before it selects (`.github/workflows/ci.yml:226`), so the map is present there; `plot-local-checks.mjs` reads the same file after a local `pnpm build:board` and names the fallback where it is absent.

### Open Questions

- [ ] `[question-selection-width]` A shared domain module sits in most bundles, so a change to it selects most contract tests. Recommendation: accept the width; a full contract run takes the time a push to main already pays, and a narrower rule is what let #3653 through.
- [ ] `[question-launcher-forms]` Launchers spell the bundle path in more than one form. Recommendation: read the `bundle=` assignment only, and add a gate that refuses a shipped launcher that runs `board/*.mjs` with no such assignment.

## Slices

### Bundle Inputs

- `bug/a-bundle-names-its-input-sources` — `build.mjs` writes `dist/bundle-inputs.json`, and `searchTerms` adds every bundle whose inputs hold a changed path <!-- builds: bundle-inputs.json, the bundle-to-source map --> <!-- tests: a change to packages/domain/src/workflows/approve.ts adds plot-approve.mjs to the search terms; a missing map falls back to BOARD_BUNDLE_ENTRIES and says so; git check-ignore holds the map file -->

### Launchers

- `bug/a-launcher-names-the-bundle-it-runs` — `launcherBundles`, and the selection adds a selected bundle's launchers as terms <!-- waits: bug/a-bundle-names-its-input-sources --> <!-- builds: launcherBundles, the launcher-to-bundle rule --> <!-- tests: the diff of #3653 selects test/reconcile/approve-batch.test.mjs; the approve launcher maps to plot-approve.mjs; a launcher with no bundle= line maps to nothing -->

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.

The slug keeps the name the sprint planned under; the measurement above shows the bundles were fresh and the selection was the gap.
