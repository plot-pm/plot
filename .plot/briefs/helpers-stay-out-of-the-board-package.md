## Implementation brief — the-tests-and-sweeps-leave-no-trace (wave 4: Helpers stay out of packages/board)

- **Plan (canonical):** `docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/helpers-stay-out-of-the-board-package` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Waves 1, 2 and 3 have merged (#1354, #1385, #1390). This branch waits on nothing and is the last wave of the plan.

### What to build

`packages/board/build.mjs` stops leaving helper copies behind in `packages/board/`.

The failure, issue #1344: the loop at `build.mjs:1319` copies every name in `vendoredScripts` (`:1240`) to the package root and never removes a copy whose name left the list. Four copies stayed as untracked files after `b6aedfb73`, `1d4cff764` and `f60a9da75` removed their names, and `git status` listed them until someone deleted them by hand. Measured at brief time on `d801d26cb`: the package root holds 19 `plot-*.sh` files, `vendoredScripts` names 19, and `git ls-files packages/board` tracks none of them. A stray therefore appears only on a checkout that built before the removal.

The change has two parts:

1. In `build.mjs`, before the copy loop, remove every `plot-*.sh` at the package root (`here`) that `vendoredScripts` does not name, and log each removal on one line (`Removed stale vendored helper plot-gone.sh`).
2. In `packages/board/.gitignore`, replace the 19 per-name lines under the "Vendored by build.mjs" comment with one pattern, `/plot-*.sh`. The comment stays and states that the pattern covers the vendored set.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Prune by the pattern `plot-*.sh` at the package root, not by an ignore-file reading.** The prune must not depend on `.gitignore`, because the pattern in step 2 would then ignore the prune's own subject. `vendoredScripts` is the one list; the prune is "everything shaped like a helper that the list does not name".

**Prune only the package root, one level.** `readdirSync(here)` filtered by name, never a recursive walk. `packages/board/src`, `test` and `dist` hold files named `plot-*` that are source, and a recursive prune would delete them.

**Delete only regular files.** Check `isFile()` before `unlinkSync`. A directory or a symlink named `plot-x.sh` is not a vendored copy and the build does not own it.

**The prune runs before the copy, and a failure to remove stops the build.** A copy loop that runs first would leave the stale file in place through a failing prune, and a swallowed `unlinkSync` error reproduces the defect silently. Use `fs.unlinkSync` in `build.mjs`: the file is generated output that the next build recreates, so the repo's `trash` rule for hand deletions does not apply.

**A tracked file is never pruned silently.** Measured: zero tracked `plot-*.sh` at the package root today. If a future change tracks one, the prune would delete source. The `.gitignore` pattern makes `git add` refuse such a file without `-f`, which is the guard; do not add a second check in the build.

**The `files` list in `package.json` is untouched.** It names the shipped helpers one by one on purpose, and `release-smoke.sh:96` tests that the vendored helpers run. A glob there would publish a stray copy.

**Rules carried over unchanged.** The 19-name list and its sourced-file comments stay as they are. A gate derives the list from the server's spawns and fails on any difference. Do not reorder or reword it.

### Done when

The plan's `## Done when` list is the specification. For this slice: *a build with a stray `plot-gone.sh` at the package root removes it*, and the test fails on `origin/main` today.

The assertions that exist because a naive implementation would pass without them:

- **A named helper survives the prune.** Catches a prune that removes every `plot-*.sh` and relies on the copy loop to restore them; the test asserts a named helper is present with its content after the build.
- **A `plot-*.sh` below the root (a fixture at `packages/board/src/`) survives.** Catches a recursive prune.
- **A directory named `plot-dir.sh` at the root survives.** Catches a prune with no `isFile()` check.
- **A non-helper file at the root (`README`, `build.mjs`, `package.json`) survives.** Catches a pattern wider than `plot-*.sh`.
- **A second build prints no removal line.** Catches a prune that logs every name it considers instead of every file it removes.
- **`git check-ignore packages/board/plot-gone.sh` exits 0.** Catches a `.gitignore` pattern that is anchored wrongly.

Write the test where the existing build tests live (`test/reconcile/artifact.test.mjs` runs the build; read how it isolates the output before you add a case, and run the build in a copy of the package, never in the operator's tree). A test that drops `plot-gone.sh` into the real `packages/board/` races the operator's board and any other agent; use a temp copy and remove it by the exact name `mkdtempSync` returned.

Plus: a changeset in `.changeset/` for package `@plot-pm/board`, `patch`, description first, `plan:` and `bumps:` last; run `./scripts/check-changeset-packages.sh`. Bump no version by hand. The slice changes `build.mjs`, so the board artifact is generated output: do not commit a rebuilt `board-server.mjs` or any bundle (`scripts/check-no-bundle-diff.sh`). Run `pnpm build:board` only to test locally, then restore the generated paths before you push.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice touches no `.sh` file, so the gate has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Write "Closes #1344" in the PR body.

### Scope guard

This branch owns `packages/board/build.mjs`, `packages/board/.gitignore`, the build test case and one changeset. Waves 1 to 3 have merged and hold no open file. Verified at brief time (`gh pr list --state open`): no open PR changes `packages/board/build.mjs`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
