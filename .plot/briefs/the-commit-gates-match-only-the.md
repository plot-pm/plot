## Implementation brief — the-commit-gates-match-only-the (wave 2: The commit rule)

- **Plan (canonical):** `docs/plans/2026-10-31-the-commit-gates-match-only-the.md` on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2984 merged
- **Branch:** `feature/the-commit-gates-match-only-the` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** per repo convention (`plot/review` status on the PR)

This is wave 2. Wave 1 (`feature/replay-aware-commit-gates`, #2986) merged on 2026-10-31 and holds the two readings that make the `--continue` forms safe to gate. This slice makes the four gates run on them. Nothing waits on this slice.

### What to build

Four gates in `packages/board/src/server/entry/gate.ts` — `bundle-commit`, `brief-name`, `state`, `phase` — decide that a Bash call makes a commit with `command.includes('git commit')`. Measured 2026-10-31 against `origin/main`, the `wants` lines sit at `:87`, `:153`, `:232` and `:397` (the plan cites `:371` for `phase`; wave 1 moved it). `git -C /x commit`, `git -c a=b commit`, `git  commit` and `git merge --continue` make a commit and no gate runs. That is how the master agent's repair of PR #2965 committed past the `state` gate. Build the commit rule, and nothing past it:

1. **`commitDirs(command)` and `makesCommit`** in `packages/domain/src/rules/main-checkout-write.ts`, beside `gitWriteDirs` (`:281`), over the existing `writeDirsWhere` (`:284`) with a commit predicate. `makesCommit = (c) => commitDirs(c).length > 0`. It uses `GLOBAL_VALUE_OPTIONS` (`:65`) and adds no option set. The predicate accepts `commit` (with or without `--amend`), and `merge`, `rebase`, `cherry-pick`, `revert` and `am` only with `--continue`; `am` also with `--resolved` or `-r`. It never accepts `--abort`, `--skip`, `--quit`, a `merge` without `--continue` (`--squash` and `--no-commit` included), `pull`, or a `cherry-pick`, `revert` or `am` that names a commit or patch. One entry per committing call; an unplaceable call (`git -C "$d" commit`, `cd "$desk" && git commit`) stays as an `unplaced` entry that names the call, where `gitWriteDirs` leaves it out (`:266-271`).
2. **The floor in each `wants`:** `command.includes('git commit') || makesCommit(command)`. The walker returns no entry for `bash -c`, `sh -c`, `eval`, `command git`, `timeout`, `nice`, `sudo` and `xargs` wrappers, so the rule alone matches less than today.
3. **A per-root loop in each gate.** Resolve each entry with `resolve(cwd, dir)` in the gate (the domain may not import `node:path`), read its repository root through `refs.repoRoot`, group by root, ask once per root, refuse when any root refuses. The `main-checkout` loop (`gate.ts:553-561`) is the model. An `unplaced` entry reads `process.cwd()` and writes one stderr line naming the gate and the call.
4. **`-C`-aware chained adds and mvs.** `chainedAddsOf` (`chained-add.ts`) and `chainedStagesOf` (`brief-name.ts`) find `git [global options] add|mv` through the walker, keep their own pathspec parsing, and count an add or mv only when it is placed in the root of the commit being judged.
5. **`takesModifiedOf` scoped to the committing call** (`state-transition.ts:406`) for a placed call, so `git fetch --all && git commit -m x` carries no working change.
6. **A floor-only line keeps today's reading:** whole-line `-a`/`--all` and substring chained adds and mvs, read at `process.cwd()`.
7. **Rename** the test `a command with no "git commit" is ignored` (`test/reconcile/bundle-commit-gate.test.mjs:134`) to `a command that makes no commit is ignored`.

### Decisions the plan settles — do not re-derive them

- **No third reader of git calls.** A parsed `commit` reader was proposed first and dropped: `writeDirsWhere` and `commitIndex` (`controller-gate.ts:87`) already read git calls, and a third option set drifts from `GLOBAL_VALUE_OPTIONS`. `mergesBy` (`controller-gate.ts:266`) reads `gh pr merge`, not git, so it is no precedent.
- **The floor stays.** Measured 2026-10-31, the walker returns `[]` for all eight wrapper forms above. A rule without the floor would match less than today and let `bash -c "git commit -am x"` carry a working-tree `State:` change past the `state` gate.
- **One ask per repository root, never per directory text.** The `state` gate spends a single-use receipt on each transition it reads (`gate.ts:320-326`). `git commit -m a && git -C sub commit -m b` in one worktree is one ask: a second ask finds the receipt spent and refuses a receipted transition.
- **Initiating forms stay unmatched.** `git merge <ref>`, `git pull`, `git cherry-pick <commit>`, `git revert <commit>` and `git am <patch>` commit content that is not in the index when a PreToolUse gate runs. A matched `pull` with a receipted change staged would spend the receipt before the real commit.
- **`-C=<dir>` is not a git form.** Add no support for it. `commit-tree` is not in `MUTATING_GIT_SUBCOMMANDS` (`:38-62`), so the walker gives it no entry; the floor still matches it, as today.
- **An unplaced entry reads `process.cwd()` and says so.** The panel rejected an `UNVERIFIED` allow, which would judge less than today.
- **Out of scope:** `controller` (`gate.ts:668`) and `role-deny` (`:795`, `:808`) read bare `process.cwd()` and go to a follow-up issue, with folding `commitIndex`'s option set (`controller-gate.ts:43`) into `GLOBAL_VALUE_OPTIONS`. `main-checkout` already places calls and needs no change.
- **Rules are arrows in the domain.** Write `export const commitDirs = (…) => …`. The unit is the function: leave neighbouring declarations in `main-checkout-write.ts` as they are. The domain imports `zod` and nothing else outside `adapters/`.
- **Known escapes stay known:** `sh -c 'cd /d && git commit'` is judged in the session tree; aliases, `--git-dir`, `--work-tree`, `GIT_DIR=` and `GIT_INDEX_FILE=` are not read. Do not widen the rule to chase them; the plan's Notes record them.
- **Carried over:** absent is not proof — an `unknown` or failed read drops nothing and clears nothing, as wave 1 does.

### Done when

The plan's `## Slices` entry for this wave and its `## Notes` table are the specification. Every row of the Notes table gives its expected pair (`wants`, `commitDirs`); lift them into a table-driven domain test. Assertions that exist because a naive implementation would pass without them:

- `bash -c "git commit -am x"` with a working-tree `State:` change **refuses** (catches a rule with no floor, or a floor that scopes `-a` away).
- `bash -c "git add -A && git commit -m x"` with a working-tree `State:` change refuses (catches scoped chained-add reading applied to a floor-only line).
- `git fetch --all && git commit -m x` with an unstaged `State:` change **allows** (catches a line-wide `--all` read).
- `git -C y add -A && git -C y commit` refuses on a hand-written `State:` line in `y`; `git add -A && git -C y commit` does not count the add when `y` is another worktree.
- `git commit -m a && git -C sub commit -m b` with one receipted transition allows (catches a per-directory ask that spends the receipt twice).
- `git merge --abort`, `git rebase --skip`, `git cherry-pick --quit`, `git merge --squash x`, `git merge --no-commit x`, `git pull`, `git cherry-pick abc`, `git status`: `wants` is false.
- One launcher test per gate (`bundle-commit`, `brief-name`, `state`, `phase`) runs `git -C <fixture> commit` from a working directory **outside** the fixture and expects exit 2. Model: `test/reconcile/bundle-commit-gate.test.mjs:69-70` (`cwd: dir`). Without the outside cwd the test passes on the session tree and proves nothing.
- Wave 1's rows again through `git merge --continue`, `git rebase --continue` and `git cherry-pick --continue` (`test/reconcile/replay-state-gate.test.mjs`, `replay-phase-gate.test.mjs`): the receipted `Draft -> Design` replay allows, its revert refuses, main's paths staged unchanged allow on a held and an implementation branch, a changed path and an uncontained `MERGE_HEAD` refuse.

Plus the repo's gates: a changeset (`plot` or `@plot-pm/board`; description first, `bumps:` last; the plan's Changelog bullets are the source), no generated bundle in the diff (`scripts/check-no-bundle-diff.sh`). Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and not `test:e2e`. The slice touches no `.sh` file; `scripts/check-shell-lines.sh` refuses shell growth, so if you touch one, remove shell elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/main-checkout-write.ts`, `chained-add.ts`, `brief-name.ts`, the `takesModifiedOf` and `effectivePaths` readings in `state-transition.ts`, the four `wants` lines and their loops in `packages/board/src/server/entry/gate.ts`, and their tests. No other slice is in flight on this plan. Do not touch the clearing rule in `state-transition.ts`, `pickedHead`, or the `MERGE_HEAD` carve-out in `gate.ts`: wave 1 owns them and they have merged. Before editing `gate.ts`, `git fetch origin main` and read it fresh — it has moved since the plan was written.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
