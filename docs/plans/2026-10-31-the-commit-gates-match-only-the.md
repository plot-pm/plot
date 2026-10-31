# The commit gates match only the literal text git commit

> The four commit gates run on every spelling of a commit whose content the index holds at hook time, read the tree each commit lands in, and allow the replayed and merged commits a repair makes.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2974
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The `bundle-commit`, `brief-name`, `state` and `phase` gates run on a commit whatever its spelling: `git -C <dir> commit`, `git -c k=v commit`, `git  commit`, `git commit --amend`, `cd <dir> && git commit`, and `merge`, `rebase`, `cherry-pick`, `revert` and `am` with `--continue`, alone or chained. Every command the gates ran on before still runs them.
- A gate that reads the working tree reads the tree each commit lands in: git's joined `-C` path over a preceding literal `cd`. A line that commits in two trees is judged in both. A commit whose directory is a parameter (`git -C "$d" commit`) is judged in the session directory, as before, and the gate writes one line that names it.
- The `state` and `phase` gates count a chained `git -C <dir> add`, and the `brief-name` gate a chained `git -C <dir> add` or `git -C <dir> mv`, when it runs in the commit's directory, so `git -C <dir> add -A && git -C <dir> commit` is judged on what it stages.
- The `state` gate allows a rebase or cherry-pick that replays a commit whose `State:` change its controller already wrote.
- The `phase` gate allows the commit that completes a merge into a held branch or a Draft plan's work branch when the merge carries the other side's files unchanged.
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

- The predicate accepts `commit` (with or without `--amend`), and `merge`, `rebase`, `cherry-pick`, `revert` and `am` only with `--continue`.
- It never accepts `--abort`, `--skip` or `--quit`, a `merge` without `--continue` (`--squash` and `--no-commit` included), `pull`, or a `cherry-pick`, `revert` or `am` that names a commit or patch.
- `commit-tree` is not in `MUTATING_GIT_SUBCOMMANDS` (`main-checkout-write.ts:38-62`), so the walker returns no entry for it.
- `-C=<dir>` is not a git form. The rule adds no support for it.

**The substring floor.** Each gate's `wants` is `command.includes('git commit') || makesCommit(command)`. The walker returns no entry where the program word is not `git`: `bash -c "git commit -m x"`, `sh -c '…'`, `eval`, `command git`, `timeout 60 git`, `nice git`, `sudo git` and `xargs git`. The floor keeps every command the gates match today, so the rule never matches less.

**One entry per committing call.** An entry is git's joined `-C` path over any earlier literal `cd`, as `gitWriteDirs` computes it, or `null` for the session directory. `gitWriteDirs` leaves out a call it cannot place (`main-checkout-write.ts:266-271`); `commitDirs` keeps it as an `unplaced` entry that names the call. The rule returns text; the gate resolves it with `resolve(cwd, dir)`, as `gate.ts:555` does, because the domain may not import `node:path`.

**The gates loop over every entry.** Each of the four gates asks once per distinct directory and refuses when any directory refuses, the `main-checkout` loop's shape (`gate.ts:553-561`). An `unplaced` entry reads `process.cwd()` as today and writes one stderr line that names the gate and the call. A line the floor matches and `commitDirs` places no call in reads `process.cwd()`, as today.

**Chained adds through the same walker.** `chainedAddsOf` (`chained-add.ts:17`) and `chainedStagesOf` (`brief-name.ts:83`) find `git [global options] add` and `git [global options] mv` through `writeDirsWhere`, keep their own pathspec parsing, and count an add or mv only when it is placed in the directory of the commit being judged.

**A replayed transition clears.** The `refs` port gains a reading of the picked commit: `REBASE_HEAD`, `CHERRY_PICK_HEAD` or `REVERT_HEAD`, read through `git rev-parse --git-path` like `mergeParents`. In the `state` gate, a transition clears with no receipt when the picked commit made the same `before -> after` change to the same path against its own first parent. A revert makes the inverse change, so a reverted transition never clears this way and needs a receipt, as today. `am` has no picked commit, so `am --continue` reads as a plain commit.

**A merge in progress carries the other side.** While `MERGE_HEAD` exists, the `phase` gate drops from its staged paths every path whose staged blob equals that path's blob at a `MERGE_HEAD` commit. `holdRefusal` and the implementation-path check (`gate.ts:430-434`) read the remaining paths. A path the resolution changed still counts as the branch's own. The decision reads `MERGE_HEAD`, not the command's spelling, so `git commit` and `git merge --continue` get the same answer.

**Order.** The two readings ship first, while the gates still run only on the substring. They change what `git commit` gets during a stopped rebase or merge today. The commit rule follows and makes the gates run on the `--continue` forms, which by then are safe.

### Decisions

Decided 2026-10-31 after panel round 1 (`.plot/panels/the-commit-gates-match-only-the/panel.md`):

- [x] The rule is `commitDirs(command)` beside `gitWriteDirs` on `writeDirsWhere` (`main-checkout-write.ts:284-311`) with a commit predicate, and `makesCommit = (c) => commitDirs(c).length > 0`. One global-option set, `GLOBAL_VALUE_OPTIONS` (`:65-73`). The earlier claim that no commit reader exists was false: `writeDirsWhere` and `commitIndex` (`controller-gate.ts:87`) both read git calls, and `mergesBy` (`controller-gate.ts:266`) reads `gh pr merge`, not git.
- [x] Each gate's `wants` is `command.includes('git commit') || makesCommit(command)`. The walker returns `[]` for `bash -c`, `sh -c`, `eval`, `command`, `timeout`, `nice`, `sudo` and `xargs` wrappers (measured 2026-10-31 against `origin/main`), so a parsed rule alone matched less than today.
- [x] The rule matches only forms whose commit the index holds at hook time: `commit` (with `--amend`), and `merge`, `rebase`, `cherry-pick`, `revert` and `am` with `--continue`. It never matches `--abort`, `--skip`, `--quit` or `merge --squash`. The `state` gate spends a single-use receipt on each transition it reads (`gate.ts:320-326`, `state-receipts-file.ts:23-41`), so a matched `pull` with a receipted change staged would spend the receipt before the real commit.
- [x] A directory is git's joined `-C` path over any earlier literal `cd`, one entry per committing call, as `gitWriteDirs` computes it (`main-checkout-write.ts:125`, `:140`, `:199`). Each gate asks every entry and refuses when any entry refuses (`gate.ts:553-561` is the model). An unplaceable entry reads `process.cwd()` as today and writes one stderr line naming the call; the panel chose this over an `UNVERIFIED` allow, which would judge less than today.
- [x] The `state` gate clears a replayed transition when the picked commit (`REBASE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`) made the same `before -> after` change against its own parent. Today it reads only `MERGE_HEAD` (`gate.ts:279-280`, `refs-git.ts:479-485`).
- [x] The `phase` gate drops a staged path whose blob equals its `MERGE_HEAD` version while a merge is in progress, so the conflict-merge repair passes `holdRefusal` (`phase-gate.ts:149-161`) and the implementation check (`gate.ts:433-434`). Merge-in-progress rows cover `phase` on a held branch and on an implementation branch, `state` and `brief-name`.
- [x] `chainedAddsOf` (`chained-add.ts:17-20`) and `chainedStagesOf` (`brief-name.ts:83-87`) read `git [global options] add|mv` through the same walker and count an add placed in the commit's directory.
- [x] One launcher test per gate runs `git -C <fixture> commit` from a working directory outside the fixture and expects exit 2. The harness at `test/reconcile/bundle-commit-gate.test.mjs:69-70` runs with `cwd: dir` and is the model. A chained `git -C y add -A && git -C y commit` row refuses.
- [x] Every table row in Notes gives its expected pair: whether `wants` matches, and what `commitDirs` returns.
- [x] Fast-forward matching is dropped with the initiating forms. `controller` (`gate.ts:668`) and `role-deny` (`gate.ts:795`, `:808`) read bare `process.cwd()` and go to a follow-up issue. `main-checkout` already places calls through `gitWriteDirs` (`gate.ts:553-555`) and needs no change.

### Open Questions

- [x] `takesModifiedOf` (`packages/domain/src/rules/state-transition.ts:399`) reads ` --all`, `-a` and `-am` anywhere in the line, so `git fetch --all && git commit` reads every working change as carried. Decided 2026-10-31: slice 2 scopes `takesModifiedOf` to the committing call that `commitDirs` returns, because the reader already isolates that call and the line-wide read refuses commits that carry no working change. Add the row `git fetch --all && git commit -m x` with an unstaged `State:` change, expecting allow.

## Slices

### Replay-aware gates

- `feature/replay-aware-commit-gates` — the `state` gate clears a transition that `REBASE_HEAD`, `CHERRY_PICK_HEAD` or `REVERT_HEAD` replays, and the `phase` gate drops staged paths equal to their `MERGE_HEAD` version, with replay and merge-in-progress rows for `phase` (held branch, implementation branch), `state` and `brief-name`, each driven through `git commit` <!-- builds: a picked-commit reading on the refs port, a merge-side carve-out in the phase gate -->

### The commit rule

- `feature/the-commit-gates-match-only-the` — `commitDirs` and `makesCommit` on `writeDirsWhere`, the substring floor in the four `wants`, the per-entry directory loop with the unplaced stderr line, `-C`-aware chained adds and mvs, the replay and merge rows again through the `--continue` forms, and one launcher test per gate <!-- builds: commitDirs and makesCommit beside gitWriteDirs -->

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
| `git add -A && git -C y commit` | yes | `["y"]`; the add is not counted in `y` |
| `git -C y add -A && git -C y commit` | yes | `["y"]`; the add is counted, and a hand-written `State:` line in `y` refuses |
| `git merge --continue` | yes | `[null]` |
| `git rebase --continue` | yes | `[null]` |
| `GIT_EDITOR=true git rebase --continue` | yes | `[null]` |
| `git cherry-pick --continue` | yes | `[null]` |
| `git revert --continue` | yes | `[null]` |
| `git am --continue` | yes | `[null]` |
| `if git commit -m x; then :; fi` | yes | `[null]` |
| `time git commit` | yes | `[null]` |
| `bash -c "git commit -m x"` | yes (floor) | `[]` |
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

- Gate rows: one launcher test per gate (`bundle-commit`, `brief-name`, `state`, `phase`) runs `git -C <fixture> commit` from outside the fixture and expects exit 2. Replay rows: a rebase that stops on a receipted `Draft -> Design` commit allows; a revert of it refuses. Merge-in-progress rows: main's paths staged unchanged allow on a held branch and on an implementation branch; a path the resolution changed still refuses there. `git merge --abort` on a held branch with main's paths staged does not match.
- Known escape, initiating forms: `git merge <ref>`, `git pull`, `git cherry-pick <commit>`, `git revert <commit>` and `git am <patch>` pass the gates unread. A PreToolUse gate reads the index before the command runs, and these commands commit content that is not in the index at that moment. `rebase --continue` is judged on the stopped commit only; the picks it replays after that commit are not in the index either.
- Known escape, other spellings: a git alias (`git ci`), `--git-dir`, `--work-tree`, `GIT_DIR=` and `GIT_INDEX_FILE=` read the session tree or the walker's placement, not the repository or index they name.
- Follow-up: controller and role-deny read process.cwd(). `controller` (`gate.ts:668`) and `role-deny` (`gate.ts:795`, `:808`) do not place a `-C` or `cd` call; the same issue folds `commitIndex`'s option set (`controller-gate.ts:43`) into `GLOBAL_VALUE_OPTIONS`.
- `test/reconcile/bundle-commit-gate.test.mjs:134` is named "a command with no "git commit" is ignored"; the commit-rule slice renames it to "a command that makes no commit is ignored".
- Related: #2970 and plan PR #2971 (the bundle gate's repair text); launchers `plot-state-gate.sh` and `plot-bundle-commit-gate.sh`, which exec the bundle with no substring test of their own.
