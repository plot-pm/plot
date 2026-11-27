## Implementation brief — a-launcher-change-selects-its-tests (wave 2: Launchers)

- **Plan (canonical):** `docs/plans/2026-11-27-a-launcher-change-selects-its-tests.md` on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-launcher-names-the-bundle-it-runs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per the repo's `Review: pr` convention

This branch waits on `bug/a-bundle-names-its-input-sources`. That branch merged as #3742, so `dist/bundle-inputs.json`, `parseBundleInputs`, `readBundleInputs` and the bundle-aware `searchTerms` exist on main. Build on them. Do not rebuild them.

### What to build

#3653 changed `packages/board/src/server/entry/approve.ts` and `packages/domain/src/workflows/approve.ts` and passed its PR CI. Main then went red on `test/reconcile/approve-batch.test.mjs:224` and `:283`. The test never names `plot-approve.mjs`. It runs the launcher `plot-approve.sh` (test line 207), and the launcher runs the bundle. Wave 1 made a changed source name every bundle that holds it. The test still names the launcher, not the bundle, so it is still not selected. This branch closes that last step.

Build this:

1. **`launcherBundles(scripts)`** in `packages/domain/src/rules/local-checks.ts`. It takes `{ path, text }[]` for the shipped `skills/**/*.sh` files and reads each file's `bundle="$script_dir/board/<name>.mjs"` assignment (`$here` is the second form in use: `plot-agent-settings.sh:92`). It answers, for each bundle basename, the basenames of the launchers that assign it. A file with no such assignment maps to nothing.
2. **The selection adds launchers.** When `searchTerms` adds a bundle's basename to a changed path's terms, it also adds the basename of each launcher of that bundle. The domain takes the launcher map as a value in its readings. The entry reads the `.sh` files, in `packages/board/src/server/entry/local-checks.ts` at the two sites that call `readBundleInputs` (CI selection and local checks). The domain imports no `node:fs`.
3. **A gate for the form.** The plan's Open Question `question-launcher-forms` is settled by its recommendation: read the `bundle=` assignment only, and refuse a launcher that runs a bundle without one. See the decisions below for the scope; the measurement narrows it.
4. **Changeset:** `'@plot-pm/board': patch`, description first, the `bumps:` block last, with a `plan:` line naming the plan inside the block.

### The decisions the plan settles — do not re-derive them

**Read the `bundle=` assignment, not every mention of `board/*.mjs`.** Measured at `0bfe3f914` over the 62 tracked `skills/**/*.sh`: 37 name a `board/*.mjs`, 20 assign it as `bundle="$script_dir|$here/board/<n>.mjs"`, and 17 do not. Those 17 are comments, mid-script calls in large scripts (`plot-dispatch.sh` 26 mentions, `plot-reconcile-scan.sh` 23, `plot-host.sh` 15) and non-bundle forms. A rule that read every mention would map `plot-host.sh` to a dozen bundles and select tests for every change to any of them. Do not widen it.

**The map is many to one.** `board/plot-gate.mjs` is the bundle of six launchers (`plot-gates.sh`, `plot-state-gate.sh`, `plot-phase-gate.sh`, `plot-controller-gate.sh`, `plot-brief-name-gate.sh`, `plot-bundle-commit-gate.sh`). A "first match wins" loop passes the approve case and drops five of these six. Add every launcher of the bundle.

**The gate's scope is the `exec` form, not the 17.** A launcher resolves its bundle and runs it with `exec node "$bundle"`, and decides nothing (CLAUDE.md, *A Shell Script Asks The Domain*). Measured: 14 shipped scripts run `exec node …`; 13 use `exec node "$bundle"` after a `bundle=` line; **one**, `skills/plot/scripts/plot-fleet-scan.sh:271`, runs `exec node "$here/board/plot-scan-walk.mjs"` with no assignment. So the gate refuses a `skills/**/*.sh` line that `exec`s a literal `board/*.mjs` path. It refuses nothing else. A gate over "any script naming `board/*.mjs`" fails on 17 files on its first run.

**The gate must pass on `main` the day it lands.** `plot-fleet-scan.sh` is its one hit. Change that line to the `bundle=` form in the same PR, so the launcher map reaches it. `scripts/check-shell-lines.sh` counts commands against the merge base, so the added assignment must be paid for: remove one command from the same file in the same change. Joining statements with `;` or `&&`, or folding `fi` or `done` onto the previous line, is not a payment. The gate stores no number and has no override. Write the gate as `scripts/check-launcher-bundles.sh` in the style of `scripts/check-bundle-resolution.sh`. CI runs every `scripts/check-*.sh`, so no workflow edit is needed. If the `Local checks` chain in CLAUDE.md lists the other gates, add this one, then run `./scripts/check-agents-md.sh --write`.

**Accept the selection width.** A change to a shared domain module selects most contract tests and now also their launcher-naming tests. The plan's `question-selection-width` is settled: accept it. A narrower rule is what let #3653 through. Locally the existing `limit` (`DEFAULT_LOCAL_CHECKS_LIMIT` = 20) reports an over-limit path and leaves it to CI. CI has no limit.

**The corpus tier stays valid because it passes no map.** `packages/domain/corpus/tests-naming.corpus.test.ts:54,60` calls `testsNaming(subjects, tests)` with no bundle argument and compares it to `git grep -F`. Do not hand that call the launcher map. If you must, extend the `git grep` side to the same terms. On a disagreement the branch stops; adjusting the rule to make it pass is the one move forbidden.

**Rules this repo keeps re-learning:** absent is not false. A launcher map that cannot be built (no `.sh` read, an unreadable file) reads "no launcher terms", and the selection's first line already names the bundle-map fallback; do not let a failed read of one `.sh` abort the selection or empty it. Read the parse result, not the emptiness of the output.

### Done when

The plan's slice annotation is the specification: (1) the diff of #3653 selects `test/reconcile/approve-batch.test.mjs`, (2) the approve launcher maps to `plot-approve.mjs`, (3) a launcher with no `bundle=` line maps to nothing.

Assertions a naive implementation passes without:

- **Use the real #3653 file list, not a hand-picked pair.** Run the selection on its 14 changed paths against the real map and launchers, and assert `approve-batch.test.mjs` is in the result. A fixture with only `workflows/approve.ts` passes while the entry reads the wrong directory.
- **A change to a module a bundle imports, with no entry change, selects the launcher's test.** This is the case wave 1 left open: `packages/domain/src/workflows/approve.ts` alone selects `approve-batch.test.mjs`.
- **A bundle with six launchers adds six names.** Catches first-match-wins.
- **A launcher named in a comment is not a launcher.** A `bundle=` text inside a `#` line, and the 17 mention-only scripts, map to nothing. Catches a regex with no line anchor.
- **The gate fails on a fixture and passes on main.** A gate test runs it against a temp `.sh` with `exec node "$x/board/y.mjs"` (expect refusal naming the file and line) and against the repo (expect pass). Use a private temp directory and remove it by the exact name `mkdtempSync` returned; `test:contracts` fails a run that leaks an entry.
- **An unreadable `.sh` does not crash the selection.** It maps to nothing and the selection continues.

Plus: the repo's gates. Domain code is arrow functions (`export const f = (…) => …`) with factual TSDoc and no decision history; the reasoning goes in the commit message. Do not commit any generated bundle under `skills/plot/scripts/board/`; `check-no-bundle-diff.sh` refuses it. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI and a failure there comes back as a correction. Run no full suite and not `pnpm run test:e2e`. The one shell file this slice touches is `plot-fleet-scan.sh`: net command count must not grow.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/local-checks.ts`, `packages/board/src/server/entry/local-checks.ts`, their tests (`packages/domain/test/local-checks.test.ts`, `test/reconcile/local-checks.test.mjs`), the new `scripts/check-launcher-bundles.sh` with its test, the one `exec` line in `skills/plot/scripts/plot-fleet-scan.sh`, and the changeset. As verified at dispatch, no open PR touches `local-checks`, `build.mjs` or `plot-fleet-scan.sh`.

Not here: `packages/board/build.mjs` and the map's shape (wave 1, merged), any other launcher `.sh`, and the 17 mention-only scripts. If you find something the plan did not anticipate, report it rather than improvising outside scope.
