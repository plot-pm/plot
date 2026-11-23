## Implementation brief — reports-name-their-cause-and-ci-selects-their-tests (slice: Entry sources)

- **Plan (canonical):** docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3611 merged
- **Branch:** `bug/an-entry-source-selects-its-bundle-tests` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the PR review channel (`Review: pr`)

This is the last slice of the plan. No slice waits on it, and it waits on none: the plan-paths slice (#3694) merged and its `estateReaders` code is on `main`.

### What to build

A pull request that changes a bundle's entry source selects no test that executes the bundle. PR #3112 changed `packages/board/src/server/entry/needs-design.ts`. CI answered `"tests":[]` for it, because `test/reconcile/needs-design-entry.test.mjs` names only the shipped bundle `plot-needs-design.mjs` (`:20`), and `searchTerms` (`packages/domain/src/rules/local-checks.ts:141`) searches test text for the changed file's basename (`needs-design.ts`) and its `.js` form (`needs-design.js`). `main`'s next build `317b020b8` failed that test.

Build three things, on top of what exists:

1. **`BOARD_BUNDLE_ENTRIES` in `packages/board/src/contract/bundles.generated.ts`.** `packages/board/build.mjs` already writes that file (`generatedBundles`, `:116`) with `BOARD_ARTIFACT_PATHS`, derived by a regex over its own `const shipped<Name> = path.join(here, '../../…')` declarations. Extend the same block to also write `BOARD_BUNDLE_ENTRIES`: one `{ entry, shipped }` pair per bundle that an `esbuild.build({ entryPoints: [path.join(here, 'src/…')], outfile: <artifact> })` call builds, with both paths relative to the repository root (73 `entryPoints` occurrences today, not all of them a pair — see the decisions below). Keep the write-only-when-changed guard: `node --watch` restarts the board on any write under `src/`.
2. **The selection reads the pairs.** `ciSelection` and `localChecks` (`local-checks.ts:502`, `:547`) take an optional `bundles` reading. A changed path equal to a pair's `entry` adds the basename of that pair's `shipped` path (`plot-needs-design.mjs`) to the search terms for that path. The tests that name the bundle are then selected through the existing `testsNaming` / `references` path, so `estateReaders` (which only handles plan data) stays untouched. `searchTerms` takes the extra term as a second parameter or the callers append it; either is fine, but a path that is not an entry gains no term.
3. **The entry file passes the pairs in.** `packages/board/src/server/entry/local-checks.ts` imports `BOARD_BUNDLE_ENTRIES` from the generated file and hands it to both calls (`ciSelection` at `:287`, `localChecks` at `:314`). The domain package never imports the board's generated file; the value arrives as a reading, as `corpus` and `tests` do.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**Only the direct entry source maps.** The alternative, reading esbuild's metafile to map every imported module to its bundles, was rejected by the operator on 2026-11-21 (Open Questions, resolved). A change to an imported module alone, such as `packages/domain/src/workflows/needs-design.ts`, still selects no bundle test, and that is the stated cost. Do not add a metafile read, and do not write a test that expects imported modules to select.

**The pairs are written by the build, not parsed from `build.mjs`'s text by the selection.** The text-parsing option (`bundlePathsOf`, `desk-dirt-filter.ts:35`) was rejected: the build already writes `bundles.generated.ts` from its own declarations and the freshness test in `test/reconcile/bundle-attribute-gate.test.mjs` holds it. A second list of bundles is the defect that file was created to remove (the list drifted three times in one evening).

**The file stays committed.** `pnpm run typecheck` runs before `build:board` in CI, so an ignored file fails on a fresh clone. A desk that has not run `pnpm build:board` also gets the same map from the committed file.

**A shipped bundle the build cannot pair is left out.** A fleet artifact the board only copies (no `entryPoints` call of this build produces it) has no `entry`. Emit no pair for it, and no pair with an empty or guessed `entry`. Absent is not a mapping.

**Building is not the gap.** CI builds the bundles from the pull request's source before the selection runs (`ci.yml:223-227`, "Build the board bundles") and before the `test/reconcile` suites (`3cd95b330`). Do not add a build step. The only `ci.yml` change is a comment at that step: it names that the selection reads `BOARD_BUNDLE_ENTRIES` and that the bundles come from the PR's source. This answers the issue's request to name the build step.

**The derivation fails hard when it finds nothing.** The existing block exits 1 when no shipped bundle is found, because a build that changed shape would otherwise blind the derivation silently. Hold the same property for the pairs: if the pairing finds zero pairs, the build fails. Also keep the existing warning in that block in mind — a complete declaration written inside a comment is matched by a regex over the file. The first draft of any new regex over `build.mjs` must be run against the whole file and its output compared against the 73 `entryPoints` sites by hand.

**Carried rules.** Absent is not false: a missing or empty `bundles` reading selects nothing new and does not throw (the plan's test: "with no pairs it selects nothing new"). Read the exit code, not the emptiness, wherever the entry reads a file.

### Done when

The plan's `## Done when` list is the specification, with the slice's tests:

- `packages/domain/test/local-checks.test.ts`: a changed `packages/board/src/server/entry/needs-design.ts` with the pair `{ entry: 'packages/board/src/server/entry/needs-design.ts', shipped: 'skills/plot/scripts/board/plot-needs-design.mjs' }` selects a test that names `plot-needs-design.mjs`; with no pairs it selects nothing new; a path that is not an entry gains no term. Add: the same input gives the same answer from `localChecks` and `ciSelection`, because slice 4 made the two callers agree on plan paths and this slice must not split them again.
- `test/reconcile/bundle-attribute-gate.test.mjs`: the freshness test (`:215-220`) also asserts that `BOARD_BUNDLE_ENTRIES` equals what the build writes, and that it holds the pair for `plot-needs-design.mjs`. This catches a hand-edited generated file, which passes every other assertion until somebody adds a bundle.
- A measurement for the PR: run `node skills/plot/scripts/board/plot-local-checks.mjs --ci --files <list>` with `packages/board/src/server/entry/needs-design.ts` as the list. Before this change the answer has `"tests":[]`; after it, `test/reconcile/needs-design-entry.test.mjs` is in `tests`. Record both answers in the PR. The plan also asks for one sandbox PR per #3149 slice that fails CI; the PR names the run.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `pnpm run test:e2e`. Run `pnpm build:board` to test the result locally, then restore every generated bundle path from `origin/main` before the push (`scripts/check-no-bundle-diff.sh` refuses a committed bundle) — but commit `packages/board/src/contract/bundles.generated.ts`, which is source and not a bundle. Add a changeset for `'@plot-pm/board': patch`, description first and the `bumps:` block last, with `plan: docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md`; run `./scripts/check-changeset-packages.sh`.

Shell gate: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file and should not. If it grows one, remove an equal number of commands elsewhere in the same change; the gate counts commands, not lines, and has no override.

New functions are arrows (`export const f = (…) => …`). TSDoc states what an export does, its parameters, its return and its failure, and carries no history.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Commit the changeset in the same PR.

### Scope guard

This branch owns: `packages/board/build.mjs` (the generated-file block only), `packages/board/src/contract/bundles.generated.ts`, `packages/domain/src/rules/local-checks.ts`, `packages/domain/test/local-checks.test.ts`, `packages/board/src/server/entry/local-checks.ts`, `test/reconcile/bundle-attribute-gate.test.mjs`, the comment at `.github/workflows/ci.yml:223`, and one changeset. Touch no bundle under `skills/plot/scripts/board/`.

The other four slices of this plan have merged or have PRs: #3626 (sibling tag read), #3684 (Jenkins sha), #3693 (desk dirt), #3694 (plan paths, merged). #3694 changed `local-checks.ts` and `local-checks.test.ts`; rebase on `origin/main` before the first edit and read `estateReaders` and the `estateTests` field before adding the `bundles` reading beside them. `desk_dirt` and `reap.ts` belong to #3693 and are out of scope.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
