## Implementation brief — the-tests-and-sweeps-leave-no-trace (wave 4: Helpers stay out of packages/board)

- **Plan (canonical):** `docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/helpers-stay-out-of-the-board-package` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the last wave. Waves 1–3 (#1354, #1385, #1390) are merged, so nothing waits on this branch and it waits on nothing. No open PR touches `packages/board/build.mjs` or `packages/board/.gitignore` (checked 2026-10-08).

### What to build

`packages/board/build.mjs` copies every name in `vendoredScripts` (`:1240`, 19 names today) from `skills/plot/scripts/` to the package root (`:1319`) and never removes a copy whose name left the list. Four copies stayed behind as untracked files after `b6aedfb73` (`plot-worker-monitor.sh`), `1d4cff764` (`plot-resolve-artifact.sh`) and `f60a9da75` (`plot-build-monitor.sh`, `plot-transcript-quiet.sh`) removed their names (#1344). They are not ignored, because `packages/board/.gitignore` lists the vendored set one name per line, so `git status` shows them and a `git add -A` commits them.

The change has two parts:

1. **Prune in `build.mjs`.** Before the copy loop, remove every `plot-*.sh` directly at the package root whose name `vendoredScripts` does not carry, and log each removal (`Removed stale vendored helper plot-gone.sh`). Only the package root, only `plot-*.sh`, only a regular file or symlink.
2. **One `.gitignore` pattern.** Replace the 19 per-name lines with `/plot-*.sh`, under the existing comment. A name added to `vendoredScripts` then needs no second edit.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The list is the source, not the directory and not `package.json`.** `vendoredScripts` is the one list the build copies from and a gate derives from the server sources (the comment at `:1231-1239` says why). Prune by that list. Do not derive the keep-set from `packages/board/package.json` `files`: it carries 20 entries (`dist/board-server.mjs` plus the 19 names) and is a second copy of the list, which is how the first drift happened.

**Check the keep-set before you delete.** Measured 2026-10-08 on `main`: `vendoredScripts` and the `plot-*.sh` files at the package root are the same 19 names, so a prune run today removes nothing. If your run removes a name, stop and read why before you continue — a prune that deletes a file the server still spawns reproduces `bash exited 127`, the failure the list's comment describes.

**The new pattern hides a stray; the prune is what removes it.** `/plot-*.sh` makes `git status` silent about a stray copy, so the prune is the only thing that cleans one up, and a build that has not run leaves it in place. That is the plan's trade (one pattern, no second list to edit). A hand-written `plot-*.sh` that belongs at the package root has no home there: sources live in `skills/plot/scripts/`.

**`git check-ignore` before and after.** `git check-ignore -v packages/board/plot-gone.sh` exits 1 on `main` today, which proves the stray is visible to git. After your change it names the new pattern. Keep that pair of readings for the PR body.

**Carried-over rules.** Remove by the exact path you read, never by a glob over a shared directory (`trash` for anything you delete by hand). Absent is not false: a missing package root file is not an error for the prune. An interrupted build leaves a half-written artifact (memory: *an interrupted build leaves a half-written artifact*), so run the prune before the copy loop and let a failed removal fail the build loudly rather than log and continue.

### Done when

The plan's `## Done when` list is the specification. The criterion for this slice: *a build with a stray `plot-gone.sh` at the package root removes it.* It fails on `main` today, because `build.mjs` has no removal.

Assertions a naive implementation passes without:

- **A kept name survives.** Put a stray `plot-gone.sh` and a name from `vendoredScripts` in the fixture directory, run the prune, assert the stray is gone and the kept name is still there. Without this half, a prune that deletes every `plot-*.sh` passes.
- **A non-matching file survives.** A file that is not `plot-*.sh` at the package root (`README.md`, `plot-notes.txt`) is untouched. It catches a prune keyed on the `plot-` prefix alone.
- **A subdirectory survives.** `packages/board/` holds `plot-*` named directories in worktrees; a recursive or directory-matching prune removes them. Assert a directory named `plot-x.sh` is not touched.
- **The log line names each removal.** Assert the output carries the removed name, one line per file.

Testing the build. `node packages/board/build.mjs` rebuilds every shipped artifact under `skills/plot/scripts/board/` and writes into your checkout, so a test that runs the whole script is slow and dirties the tree. Prefer to write the prune as a small arrow function that takes the directory and the keep-set (an export in a module `build.mjs` imports, or an existing helper module if one fits), and unit-test it against a temp directory made with `mkdtempSync` and removed by the exact name it returned. If you instead run the whole build in a test, point it at a sandbox copy. Do not run `test:board` locally while the operator's board is open: it rebuilds the artifact and takes the board down (memory: *Local test:board takes the operator's board down*). `packages/board/test/*.test.mjs` is where board tests live; run the whole file you add, and read the summary line rather than the exit code.

The repo's gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.
- Add a changeset in `.changeset/` for `@plot-pm/board`, `patch`, description first, `plan:` line last in the comment block (`./scripts/check-changeset-packages.sh` refuses the other order and a description under 20 characters):

  ```markdown
  ---
  '@plot-pm/board': patch
  ---

  A board build removes a `plot-*.sh` helper copy at the package root that `vendoredScripts` no longer names, and `packages/board/.gitignore` ignores the vendored set with one pattern (#1344).

  <!--
  plan: docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md
  -->
  ```

- Your diff must carry no generated bundle (`scripts/check-no-bundle-diff.sh`). `build.mjs` is source, so a change to it triggers a local rebuild: restore every generated path under `skills/plot/scripts/board/` from the merge base before you push (the gate's refusal prints the command). `main` rebuilds its own bundles after every merge.
- This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply. Keep it that way: the prune is JavaScript in `build.mjs`.
- The function you write is an arrow (`export const f = (…) => …` or `const f = (…) => …`), per the repo's rule that the diff follows the function. Do not convert the 500-odd `function` declarations that surround it.
- Commit messages for a board-package change use a plain description, as `Endings that get a fresh agent (#1388)` does; the `plot:` prefix is for the hub and cross-cutting changes.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, and set the PR to "Ready" on the project board only if one is configured (none is, in this repo's `## Plot Config`).
- Push the first real commit as soon as it exists.
- PR body: say that #1344 closes with this change, and name the `git check-ignore` pair from above.

### Scope guard

This branch owns `packages/board/build.mjs`, `packages/board/.gitignore`, the test for the prune, and one changeset. Wave 3's `plot-reconcile-scan.sh` and the corpus, `local-checks.ts` and `plot-default-branch.sh` changes of waves 1–2 are merged and out of scope.

If you find something the plan did not anticipate — a name in `package.json` `files` that `vendoredScripts` lacks, or the reverse — report it in the PR body and leave the other list alone. Do not edit `package.json` `files` in this branch.
