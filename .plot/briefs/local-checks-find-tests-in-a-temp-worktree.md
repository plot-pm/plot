## Implementation brief — the-tests-and-sweeps-leave-no-trace (slice 2: Local checks in a temp worktree)

- **Plan (canonical):** `docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/local-checks-find-tests-in-a-temp-worktree` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Second slice of four. Slice 1 (#1354) merged, so this slice is eligible. Slices 3 and 4 wait on this one by heading order (`rules/eligible.ts:131-134`), not by code: none touches a file this branch owns.

### What to build

`plot-local-checks` prints a `vitest related` command that names the changed file's real path, so the command finds its test in a worktree under a symlinked temp directory on macOS.

The failure, measured (#1317): under `/var` against `/private/var`, `vitest related` finds no test and the check reads as a pass. A check that finds nothing and exits 0 is indistinguishable from a check that ran.

The code path: `run` in `packages/board/src/server/entry/local-checks.ts` takes `repoRoot` from `refsGit(...).repoRoot()` (`git rev-parse --show-toplevel`, `packages/domain/src/adapters/refs/refs-git.ts:403`) and passes it as `root` to `localChecks`. `fill` in `packages/domain/src/rules/local-checks.ts:148-151` joins `root` with each relative path. The plan's fix: resolve `repoRoot` and every `{changed}` path through `realpath` before the commands are built.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Normalise in the entry point, not in the rule.** `localChecks` is a pure rule over readings (`rules/local-checks.ts`); it must stay synchronous and free of `node:fs`. `realpath` is a world read, so it belongs where the readings are taken, in `entry/local-checks.ts` or the `refsGit` adapter. `realpath` is already applied to desks in `rules/desk-manifest.ts` and `rules/desk-worker.ts` — read how those get their value in before adding a second pattern.

**Reproduce before fixing.** `git rev-parse --show-toplevel` often already returns the real path, so the mismatch may come from `cwd` (passed through `process.cwd()` or the caller) rather than from `root`. Make the failing fixture first: a repository created under a symlinked directory (`fs.symlinkSync` to a real directory, then `cwd` = the symlink path), assert the printed command, and watch it fail on `main`. Fix the side the fixture shows to be wrong. Do not normalise blindly on both sides if only one differs.

**Answered 2026-10-08 (plan Notes, direction from jwloka): #1317 does not reproduce through the entry point.** On macOS with git 2.55.0 and Node 18 to 24, `process.cwd()` and `git rev-parse --show-toplevel` already return the real path, so `repoRoot` is never the symlinked form. This ends the reproduction question above; do not spend more time trying to reproduce it end to end. Instead:

- Keep the `realpathSync` fix as a defensive change, in the `desk-manifest.ts` pattern.
- Meet the "fails on `origin/main`" criterion at a seam: give the code that builds the `{changed}` paths a symlinked root, and assert the printed path is the real path. That test fails on `main`.
- Keep the vitest root-versus-argument fixture as evidence of the mechanism.
- State the deviation in the PR body and write `Refs #1317`, not `Closes #1317`.

**A path that does not exist cannot be realpath-ed.** A changed file that the branch deleted has no real path. Resolve the real directory of the root and join the relative path; do not call `realpath` on a deleted file, and do not drop it from `changed`.

**Rules carried over unchanged.**

- **Absent is not false.** A test not found is not a test passed. This slice fixes one cause of a silent no-test; do not add a "no tests found, so OK" arm.
- **The shipped bundle is generated.** `skills/plot/scripts/board/plot-local-checks.mjs` is built output; a PR diff must carry no generated bundle (`scripts/check-no-bundle-diff.sh`). Run `pnpm build:board` only to test locally, then restore the generated paths before pushing. `test/reconcile/local-checks.test.mjs` reads the bundle, so build first or the test reads a stale one.
- **Functions you write are arrows.** `packages/domain/**` requires `export const f = (…) => …`; anywhere else a function you write is also an arrow.
- **A test that creates a temp directory removes it by the exact name `mkdtempSync` returned.** `scripts/owned-run.sh` fails a run that leaks an entry. On macOS `os.tmpdir()` is already `/var/folders/…`, a symlink to `/private/var/…`: a sandbox made there is the symlinked case with no extra setup, which is also why the existing `test/reconcile/local-checks.test.mjs` sandbox may already exercise it — check it does not hide the bug by realpath-ing first.

### Done when

The plan's slice-2 assertion is the specification: a worktree under a symlinked temp directory prints a `vitest related` command that names the changed file's real path, and the command finds its test.

Assertions that exist because a naive implementation passes without them:

- **Assert the real path, not just "contains the file name".** A test that matches on the basename passes on `/var/…` and on `/private/var/…` alike. Compare the full path against `fs.realpathSync` of the fixture file.
- **Run the printed command.** The plan says "the command finds its test". Execute it (or `vitest related` equivalent in the fixture) and assert it reports a test; an output-text check alone proves only the string.
- **Make the arms disagree.** Include the non-symlinked case and assert its output is unchanged, so a fix that rewrites every path fails; and a deleted-file case that still appears in `changed`.
- **The test fails on `origin/main` (`a778bda0d` or later).** Revert the fix in place and confirm it goes red before trusting it.

Plus: a changeset (`'plot': patch`, description first, `bumps:` block last, `plan:` line inside the comment), and the checks. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: remove shell elsewhere or write the rule in the domain. This slice should touch no shell.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/board/src/server/entry/local-checks.ts`, `packages/domain/src/adapters/refs/refs-git.ts` and `packages/domain/src/rules/local-checks.ts` as far as the fix needs them, their tests (`test/reconcile/local-checks.test.mjs`, `packages/domain/test/local-checks.test.ts`, `packages/domain/test/refs-git-local-checks.test.ts`), and one changeset.

In flight beside it, none touching these files: `bug/a-run-no-runner-took-is-no-answer` and `bug/deliver-reads-the-pr-index-first` (desks under `.worktrees/`). Slice 3 owns `plot-reconcile-scan.sh` section 14; slice 4 owns `packages/board/build.mjs` and `packages/board/.gitignore`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
