# The commit gates match only the literal text git commit

> The four commit gates run on every spelling of a commit whose content the index holds at hook time, read the tree each commit lands in, and allow the replayed and merged commits a repair makes.

## Status

- **State:** Delivered
- **Type:** feature
- **Issue:** #2974
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2984 merged
- **Started:** 2026-10-31, Jan Wloka, `feature/replay-aware-commit-gates`
- **Started:** 2026-10-31, Jan Wloka, `feature/the-commit-gates-match-only-the`
- **Delivered:** 2026-11-01

## Changelog

- The `bundle-commit`, `brief-name`, `state` and `phase` gates run on a commit whatever its spelling: `git -C <dir> commit`, `git -c k=v commit`, `git  commit`, `git commit --amend`, `cd <dir> && git commit`, and `merge`, `rebase`, `cherry-pick`, `revert` and `am` with `--continue` (and `am` with `--resolved` or `-r`), alone or chained. Every command the gates ran on before still runs them.
- A gate that reads the working tree reads the tree each commit lands in: git's joined `-C` path over a preceding literal `cd`. A line that commits in two trees is judged in both. A commit whose directory is a parameter (`git -C "$d" commit`) is judged in the session directory, as before, and the gate writes one line that names it.
- The `state` and `phase` gates count a chained `git -C <dir> add`, and the `brief-name` gate a chained `git -C <dir> add` or `git -C <dir> mv`, when it runs in the commit's directory, so `git -C <dir> add -A && git -C <dir> commit` is judged on what it stages.
- The `state` and `phase` gates read `-a`, `-am` and `--all` only on the committing call, so `git fetch --all && git commit -m x` no longer carries the working changes. A line that only the substring floor matches keeps today's whole-line reading of `-a`, `--all` and chained adds and mvs.
- The `state` gate allows a rebase or cherry-pick that replays a commit whose `State:` change its controller already wrote.
- The `phase` gate allows the commit that completes a merge of the default branch into a held branch or a Draft plan's work branch when the merge carries the default branch's files unchanged. A merge of another branch is refused as today.
- `git merge <ref>`, `git pull`, `git cherry-pick <commit>`, `git revert <commit>` and `git am <patch>` still pass the four gates unread: the commit each makes is not in the index when the gates run.

<!-- Board impact: none. A PreToolUse gate's matching rule and two gate readings. No plan format, template, helper script table or docs/plans layout changes. -->

## Motivation

Four gates in `packages/board/src/server/entry/gate.ts` decide that a Bash call makes a commit with `command.includes('git commit')`: `bundle-commit` (`:87`), `brief-name` (`:153`), `state` (`:232`) and `phase` (`:371`). Each reads the tree at `process.cwd()` (`:95`, `:160`, `:242`, `:388`). Measured 2026-10-31 over five command strings:

| Command | Makes a commit | Gates run |
|---|---|---|
| `git -C /x commit -m y` | yes | no |
| `git merge --continue` | yes | no |
| `git -c a=b commit` | yes | no |
| `git  commit` (two spaces) | yes | no |
| `git commit-tree` | writes a commit object, no ref | yes |

- The master agent's repair of PR #2965 committed with `git -C <worktree> commit` and `git -C <worktree> merge`. No gate read either call. Panel round 1 reproduced it: with a `State:` change staged, `plot-gate.mjs state` refuses `git commit -m x` (exit 2) and allows `git -C <fixture> commit -m x`, `git  commit -m x` and `git merge --continue` (exit 0).
- The `state` gate is how `plot-state-gate.sh` refuses a hand-written `State:` line, so the same forms pass that rule.
- The chained-add readers search for the text `git add` (`packages/domain/src/rules/chained-add.ts:20`) and `git mv` (`packages/domain/src/rules/brief-name.ts:86`). `git -C <wt> add -A && git -C <wt> commit` therefore reads the index before the add, and a hand-written `State:` line in the working tree reaches the commit.
- Two gates refuse a legitimate repair today. The `state` gate reads `MERGE_HEAD` as the only other parent (`gate.ts:279-280`, `packages/domain/src/adapters/refs/refs-git.ts:479-485`), so `git commit` during a rebase that stops on a receipted `State:` change is refused: the receipt was spent when the original commit was made (measured by the testability juror, exit 2). The `phase` gate reads every staged path as the branch's own (`gate.ts:430`, `:433-434`; `holdRefusal`, `packages/domain/src/rules/phase-gate.ts:149-161`), so `git commit` that completes a conflicted merge of main into a held branch or a Draft plan's work branch is refused.
- Two readers of git calls already exist. `writeDirsWhere` (`packages/domain/src/rules/main-checkout-write.ts:284-311`) skips git's global options (`:65-73`), joins successive `-C` paths (`:199`), follows a literal `cd` or `pushd` (`:140`) and strips leading keywords (`:155`); `gitWriteDirs` (`:281`) and `treeStrandingResetDirs` (`:334`) call it with an `accepts(sub, args)` predicate, and the `main-checkout` gate loops over its entries (`gate.ts:553-555`). `commitIndex` (`packages/domain/src/rules/controller-gate.ts:87`) finds `commit` after a smaller option set (`:43`).
- A PreToolUse gate reads the index before the command runs. `git merge <ref>`, `git pull`, `git cherry-pick <commit>`, `git revert <commit>` and `git am <patch>` commit content that is not in the index at that moment, so no gate can judge them. Only `commit` and the `--continue` forms commit what the index holds.
- The panel on #2971 (`the-bundle-gate-refuses-the-repair`, seams juror) found this gap and left it out of that plan's scope.

## Design

### Approach

**The commit rule over the existing walker.** `main-checkout-write.ts` exports `commitDirs(command)` beside `gitWriteDirs`, built on `writeDirsWhere` with a commit predicate, and `makesCommit = (command) => commitDirs(command).length > 0`. It uses the walker's `GLOBAL_VALUE_OPTIONS` and adds no option set of its own. No third reader of git calls is added.

- The predicate accepts `commit` (with or without `--amend`), and `merge`, `rebase`, `cherry-pick`, `revert` and `am` only with `--continue`. It also accepts `am` with `--resolved` or `-r`, git's two synonyms for `am --continue`.
- It never accepts `--abort`, `--skip` or `--quit`, a `merge` without `--continue` (`--squash` and `--no-commit` included), `pull`, or a `cherry-pick`, `revert` or `am` that names a commit or patch.
- `commit-tree` is not in `MUTATING_GIT_SUBCOMMANDS` (`main-checkout-write.ts:38-62`), so the walker returns no entry for it.
- `-C=<dir>` is not a git form. The rule adds no support for it.

**The substring floor.** Each gate's `wants` is `command.includes('git commit') || makesCommit(command)`. The walker returns no entry where the program word is not `git`: `bash -c "git commit -m x"`, `sh -c '…'`, `eval`, `command git`, `timeout 60 git`, `nice git`, `sudo git` and `xargs git`. The floor keeps every command the gates match today, so the rule never matches less.

**One entry per committing call.** An entry is git's joined `-C` path over any earlier literal `cd`, as `gitWriteDirs` computes it, or `null` for the session directory. `gitWriteDirs` leaves out a call it cannot place (`main-checkout-write.ts:266-271`); `commitDirs` keeps it as an `unplaced` entry that names the call. The rule returns text; the gate resolves it with `resolve(cwd, dir)`, as `gate.ts:555` does, because the domain may not import `node:path`.

**The gates loop over every repository root.** The gate resolves each entry to its directory and reads that directory's repository root through the `refs` port's `repoRoot`. It groups the entries by root and asks once per root, not once per directory text: the `state` gate spends a single-use receipt on each transition it reads (`gate.ts:320-326`), so a second ask over the same index finds the receipt spent and refuses a receipted transition. `git commit -m a && git -C sub commit -m b` in one worktree, and a `null` entry beside an `unplaced` one, are each one ask. The gate refuses when any root refuses, the `main-checkout` loop's shape (`gate.ts:553-561`). An `unplaced` entry reads `process.cwd()` as today and writes one stderr line that names the gate and the call.

**A floor-only line keeps today's reading.** When the floor matches and `commitDirs` places no call, the gate reads `process.cwd()` and passes the whole line to `effectivePaths` (`state-transition.ts:456-460`), as today. `takesModifiedOf` (`state-transition.ts:399-400`) reads `-a` and `--all` anywhere in the line. `chainedAddsOf` (`chained-add.ts:17-28`) and `chainedStagesOf` (`brief-name.ts:83-87`) find `git add` and `git mv` in any segment, quoted text included. The walker removes quoted text (`main-checkout-write.ts:288`), so a scoped reading would find no committing call and no placed add in `bash -c "git commit -am x"` or `bash -c "git add -A && git commit -m x"`, and a hand-written `State:` line in the working tree would reach the commit. The scoped readings below apply only to a call `commitDirs` places.

**`-a` is read on the committing call.** For a placed call, `takesModifiedOf` reads the arguments of the committing calls in that root, not the whole line, so `git fetch --all && git commit -m x` carries no working change. The line-wide read carries every working change into a commit whose own call takes none.

**Chained adds through the same walker.** `chainedAddsOf` (`chained-add.ts:17`) and `chainedStagesOf` (`brief-name.ts:83`) find `git [global options] add` and `git [global options] mv` through `writeDirsWhere`, keep their own pathspec parsing, and count an add or mv only when it is placed in the repository root of the commit being judged. A floor-only line keeps the substring readers, as above.

**A replayed transition clears.** The `refs` port gains a reading of the picked commit: `REBASE_HEAD` or `CHERRY_PICK_HEAD`, read through `git rev-parse --git-path` like `mergeParents`. In the `state` gate, a transition clears with no receipt when the picked commit made the same `before -> after` change to the same path against its own first parent. The gate does not read `REVERT_HEAD`: a revert makes the inverse change, so a reverted transition can never match and needs a receipt, as today. `am` has no picked commit, so `am --continue` reads as a plain commit.

**A merge of the default branch carries the other side.** While `MERGE_HEAD` exists and each `MERGE_HEAD` commit is contained in `origin/<main>` (`Refs.contains`, `ports/refs.ts:701`; `main` as `gate.ts:436-440` reads it), the `phase` gate drops from its staged paths every path whose staged blob equals that path's blob at a `MERGE_HEAD` commit. A `MERGE_HEAD` that `contains` answers `no` or `unknown` for drops no path, so a conflicted merge of another branch into a held branch or a Draft plan's work branch is refused as today. `holdRefusal` and the implementation-path check (`gate.ts:430-434`) read the remaining paths. A path the resolution changed still counts as the branch's own. The decision reads `MERGE_HEAD`, not the command's spelling, so `git commit` and `git merge --continue` get the same answer.

**Order.** The two readings ship first, while the gates still run only on the substring. They change what `git commit` gets during a stopped rebase or merge today. The commit rule follows and makes the gates run on the `--continue` forms, which by then are safe.

### Decisions

Decided 2026-10-31 after panel round 1 (`.plot/panels/the-commit-gates-match-only-the/panel.md`):

- [x] The rule is `commitDirs(command)` beside `gitWriteDirs` on `writeDirsWhere` (`main-checkout-write.ts:284-311`) with a commit predicate, and `makesCommit = (c) => commitDirs(c).length > 0`. One global-option set, `GLOBAL_VALUE_OPTIONS` (`:65-73`). The earlier claim that no commit reader exists was false: `writeDirsWhere` and `commitIndex` (`controller-gate.ts:87`) both read git calls, and `mergesBy` (`controller-gate.ts:266`) reads `gh pr merge`, not git.
- [x] Each gate's `wants` is `command.includes('git commit') || makesCommit(command)`. The walker returns `[]` for `bash -c`, `sh -c`, `eval`, `command`, `timeout`, `nice`, `sudo` and `xargs` wrappers (measured 2026-10-31 against `origin/main`), so a parsed rule alone matched less than today.
- [x] The rule matches only forms whose commit the index holds at hook time: `commit` (with `--amend`), and `merge`, `rebase`, `cherry-pick`, `revert` and `am` with `--continue`, and `am` with `--resolved` or `-r`. It never matches `--abort`, `--skip`, `--quit` or `merge --squash`. The `state` gate spends a single-use receipt on each transition it reads (`gate.ts:320-326`, `state-receipts-file.ts:23-41`), so a matched `pull` with a receipted change staged would spend the receipt before the real commit.
- [x] A directory is git's joined `-C` path over any earlier literal `cd`, one entry per committing call, as `gitWriteDirs` computes it (`main-checkout-write.ts:125`, `:140`, `:199`). Each gate groups the entries by resolved repository root, asks once per root, and refuses when any root refuses (`gate.ts:553-561` is the model). One ask per root keeps a second ask from finding a receipt the first one spent (`gate.ts:320-326`). An unplaceable entry reads `process.cwd()` as today and writes one stderr line naming the call; the panel chose this over an `UNVERIFIED` allow, which would judge less than today.
- [x] The `state` gate clears a replayed transition when the picked commit (`REBASE_HEAD`, `CHERRY_PICK_HEAD`) made the same `before -> after` change against its own parent. It does not read `REVERT_HEAD`: a revert makes the inverse change, so it never clears. Today it reads only `MERGE_HEAD` (`gate.ts:279-280`, `refs-git.ts:479-485`).
- [x] The `phase` gate drops a staged path whose blob equals its `MERGE_HEAD` version while a merge of a `MERGE_HEAD` contained in `origin/<main>` is in progress, so the conflict-merge repair passes `holdRefusal` (`phase-gate.ts:149-161`) and the implementation check (`gate.ts:433-434`). Merge-in-progress rows cover `phase` on a held branch and on an implementation branch, `state` and `brief-name`.
- [x] `chainedAddsOf` (`chained-add.ts:17-20`) and `chainedStagesOf` (`brief-name.ts:83-87`) read `git [global options] add|mv` through the same walker and count an add placed in the commit's repository root.
- [x] When the floor matches and `commitDirs` places no call, the gates keep today's whole-line reading of `-a`/`--all` (`takesModifiedOf`, `state-transition.ts:399-400`) and of chained adds and mvs (`chained-add.ts:17-28`, `brief-name.ts:83-87`). The scoped readings find no call in a wrapper form, so they would carry less than today.
- [x] One launcher test per gate runs `git -C <fixture> commit` from a working directory outside the fixture and expects exit 2. The harness at `test/reconcile/bundle-commit-gate.test.mjs:69-70` runs with `cwd: dir` and is the model. A chained `git -C y add -A && git -C y commit` row refuses.
- [x] Every table row in Notes gives its expected pair: whether `wants` matches, and what `commitDirs` returns.
- [x] Fast-forward matching is dropped with the initiating forms. `controller` (`gate.ts:668`) and `role-deny` (`gate.ts:795`, `:808`) read bare `process.cwd()` and go to a follow-up issue. `main-checkout` already places calls through `gitWriteDirs` (`gate.ts:553-555`) and needs no change.

### Open Questions

- [x] `takesModifiedOf` (`packages/domain/src/rules/state-transition.ts:399`) reads ` --all`, `-a` and `-am` anywhere in the line, so `git fetch --all && git commit` reads every working change as carried. Decided 2026-10-31: slice 2 scopes `takesModifiedOf` to the committing call that `commitDirs` returns, because the reader already isolates that call and the line-wide read refuses commits that carry no working change. A floor-only line keeps the line-wide read. The Notes table carries the row `git fetch --all && git commit -m x`.

## Slices

### Replay-aware gates

- `feature/replay-aware-commit-gates` — the `state` gate clears a transition that `REBASE_HEAD` or `CHERRY_PICK_HEAD` replays, and the `phase` gate drops staged paths equal to their `MERGE_HEAD` version when `MERGE_HEAD` is contained in `origin/<main>`, with replay and merge-in-progress rows for `phase` (held branch, implementation branch), `state` and `brief-name`, each driven through `git commit` <!-- builds: a picked-commit reading on the refs port, a merge-side carve-out in the phase gate --> → #2986

### The commit rule

- `feature/the-commit-gates-match-only-the` — `commitDirs` and `makesCommit` on `writeDirsWhere`, the substring floor in the four `wants`, the per-root loop with the unplaced stderr line, `-C`-aware chained adds and mvs, `takesModifiedOf` scoped to the committing call, today's whole-line reading of `-a`/`--all` and chained adds and mvs for a floor-only line, the replay and merge rows again through the `--continue` forms, and one launcher test per gate <!-- builds: commitDirs and makesCommit beside gitWriteDirs --> → #2990

## Notes

- Test table for `commitDirs` and `wants`, as (matches, directory). `null` is the session directory; `unplaced` reads `process.cwd()` and writes a stderr line; `floor` means `wants` matches through the substring while `commitDirs` returns `[]`, so the gate reads `process.cwd()`. The walker column was measured 2026-10-31 with `gitWriteDirs` from `origin/main`.

| Command | Matches | `commitDirs` |
|---|---|---|
| `git commit -m x` | yes | `[null]` |
| `git commit --amend` | yes | `[null]` |
| `git -C /x commit -m y` | yes | `["/x"]` |
| `git -C /a -C b commit` | yes | `["/a/b"]` |
| `git -c a=b commit` | yes | `[null]` |
| `git  commit` (two spaces) | yes | `[null]` |
| `cd x && git commit` | yes | `["x"]` |
| `cd x && git -C sub commit` | yes | `["x/sub"]` |
| `git -C /a commit && git -C /b commit` | yes | `["/a", "/b"]` |
| `git -C "$d" commit` | yes | `[unplaced]` |
| `cd "$desk" && git commit` | yes | `[unplaced]` |
| `git add -A && git -C y commit` | yes | `["y"]`; the add is not counted when `y` is another worktree |
| `git -C y add -A && git -C y commit` | yes | `["y"]`; the add is counted, and a hand-written `State:` line in `y` refuses |
| `git merge --continue` | yes | `[null]` |
| `git rebase --continue` | yes | `[null]` |
| `GIT_EDITOR=true git rebase --continue` | yes | `[null]` |
| `git cherry-pick --continue` | yes | `[null]` |
| `git revert --continue` | yes | `[null]` |
| `git am --continue` | yes | `[null]` |
| `git am --resolved` | yes | `[null]` |
| `git am -r` | yes | `[null]` |
| `git commit -m a && git -C sub commit -m b` | yes | `[null, "sub"]`; one root, one ask; one receipted transition allows |
| `git fetch --all && git commit -m x` | yes | `[null]`; `-a` is read on the commit only, so an unstaged `State:` change is not carried and the `state` gate allows |
| `if git commit -m x; then :; fi` | yes | `[null]` |
| `time git commit` | yes | `[null]` |
| `bash -c "git commit -m x"` | yes (floor) | `[]` |
| `bash -c "git commit -am x"` | yes (floor) | `[]`; the whole-line read carries a working-tree `State:` change, so the `state` gate refuses |
| `bash -c "git add -A && git commit -m x"` | yes (floor) | `[]`; the whole-line read counts the add, so a working-tree `State:` change refuses |
| `sh -c 'cd /d && git commit -m x'` | yes (floor) | `[]` |
| `eval "git commit -m x"` | yes (floor) | `[]` |
| `command git commit` | yes (floor) | `[]` |
| `timeout 60 git commit -m x` | yes (floor) | `[]` |
| `nice git commit` | yes (floor) | `[]` |
| `sudo git commit` | yes (floor) | `[]` |
| `xargs git commit` | yes (floor) | `[]` |
| `git commit-tree abc` | yes (floor) | `[]` |
| `echo "run git commit later"` | yes (floor) | `[]` |
| `git merge origin/main` | no | `[]` |
| `git merge --no-commit x` | no | `[]` |
| `git merge --squash x` | no | `[]` |
| `git merge --abort` | no | `[]` |
| `git rebase --skip` | no | `[]` |
| `git cherry-pick --quit` | no | `[]` |
| `git pull` | no | `[]` |
| `git cherry-pick abc` | no | `[]` |
| `git rebase main` | no | `[]` |
| `git status` | no | `[]` |

- Gate rows: one launcher test per gate (`bundle-commit`, `brief-name`, `state`, `phase`) runs `git -C <fixture> commit` from outside the fixture and expects exit 2. Replay rows: a rebase that stops on a receipted `Draft -> Design` commit allows; a revert of it refuses. Merge-in-progress rows: main's paths staged unchanged allow on a held branch and on an implementation branch; a path the resolution changed still refuses there; another branch's paths staged unchanged, its `MERGE_HEAD` not contained in `origin/<main>`, refuse on a held branch as today. `git merge --abort` on a held branch with main's paths staged does not match.
- Known escape, initiating forms: `git merge <ref>`, `git pull`, `git cherry-pick <commit>`, `git revert <commit>` and `git am <patch>` pass the gates unread. A PreToolUse gate reads the index before the command runs, and these commands commit content that is not in the index at that moment. `rebase --continue` is judged on the stopped commit only; the picks it replays after that commit are not in the index either.
- Known escape, a floor-only wrapper that changes directory: `sh -c 'cd /d && git commit -m x'` is judged in the session tree, not in `/d`. The walker reads no call inside quoted text, so the Changelog's "reads the tree each commit lands in" does not hold for it.
- Known escape, other spellings: a git alias (`git ci`), `--git-dir`, `--work-tree`, `GIT_DIR=` and `GIT_INDEX_FILE=` read the session tree or the walker's placement, not the repository or index they name.
- Follow-up: controller and role-deny read process.cwd(). `controller` (`gate.ts:668`) and `role-deny` (`gate.ts:795`, `:808`) do not place a `-C` or `cd` call; the same issue folds `commitIndex`'s option set (`controller-gate.ts:43`) into `GLOBAL_VALUE_OPTIONS`.
- `test/reconcile/bundle-commit-gate.test.mjs:134` is named "a command with no "git commit" is ignored"; the commit-rule slice renames it to "a command that makes no commit is ignored".
- Related: #2970 and plan PR #2971 (the bundle gate's repair text); launchers `plot-state-gate.sh` and `plot-bundle-commit-gate.sh`, which exec the bundle with no substring test of their own.
