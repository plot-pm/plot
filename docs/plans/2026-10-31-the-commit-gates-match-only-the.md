# The commit gates match only the literal text git commit

> One domain rule reads a shell command and answers whether it makes a commit, and the four commit gates call it instead of testing for the substring `git commit`.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2974
- **Review:** pr
- **Impl:** own branches

## Changelog

- The `bundle-commit`, `brief-name`, `state` and `phase` gates run on every Bash call that makes a commit: `git -C <dir> commit`, `git -c k=v commit`, `git  commit`, `git merge`, `git merge --continue`, `git cherry-pick`, `git revert`, `git am`, `git pull` and `git rebase --continue`, alone or chained with `&&`, `;` and `|`. `git commit-tree` no longer runs them. A gate that reads the working tree reads the tree `-C <dir>` names.

<!-- Board impact: none. A PreToolUse gate's matching rule. No plan format, template, helper script table or docs/plans layout changes. -->

## Motivation

Four gates in `packages/board/src/server/entry/gate.ts` decide that a Bash call makes a commit with `command.includes('git commit')`: `bundle-commit` (`:87`), `brief-name` (`:153`), `state` (`:232`) and `phase` (`:371`). Measured 2026-10-31 over five command strings:

| Command | Makes a commit | Gates run |
|---|---|---|
| `git -C /x commit -m y` | yes | no |
| `git merge --continue` | yes | no |
| `git -c a=b commit` | yes | no |
| `git  commit` (two spaces) | yes | no |
| `git commit-tree` | writes a commit object, no ref | yes |

- The master agent's repair of PR #2965 committed with `git -C <worktree> commit` and `git -C <worktree> merge`. No gate read either call.
- The `state` gate is how `plot-state-gate.sh` refuses a hand-written `State:` line, so the same forms pass that rule.
- A `git merge` that commits with no conflict, and `git pull`, `git cherry-pick`, `git revert` and `git am`, also make commits and match no gate.
- The panel on #2971 (`the-bundle-gate-refuses-the-repair`, seams juror) found this and left it out of that plan's scope.

## Design

### Approach

**One rule, over the parsed command.** `makesCommit(command)` in `packages/domain/src/rules/` returns whether any simple command in the line makes a commit, and returns the directory a `-C` option names. It reads the line through `readShell` (`rules/shell-reading.ts`), which already splits simple commands on `&&`, `;`, `|` and subshells and removes quotes. A line `readShell` returns `null` for falls back to the substring test, so the rule never matches less than the gates match today.

- git's global options are skipped before the subcommand: `-C <dir>`, `-c <k=v>`, `--git-dir`, `--work-tree` and `--namespace`, in both `--opt value` and `--opt=value` forms.
- The subcommands that commit are `commit`, `merge` (unless `--no-commit`), `cherry-pick`, `revert`, `am`, `pull` and `rebase --continue`. `merge --continue` is a `merge` without `--no-commit`.
- Plumbing is not matched. `commit-tree` is a different subcommand word, so it falls out of an exact comparison.
- Each gate's `wants` calls the rule. A gate that reads the working tree takes the rule's directory (the last `-C` of the matching simple command, resolved against the session directory) in place of `process.cwd()`.

**Reuse.** The deliverable search found no existing commit test. `controller-gate.ts` already reads simple commands for merges (`mergesBy`); the new rule follows its shape and shares `readShell`.

**Over-matching is the cheaper error.** A gate that runs on a command that commits nothing reads the index and allows. A gate that skips a command that commits lets the commit through. `git merge` and `git pull` therefore match even when they fast-forward.

### Open Questions

- [ ] `git pull` and `git merge` without `--no-commit` match even when they fast-forward and commit nothing. The gates read the index and allow a clean one; confirm that cost is accepted.
- [ ] `git -C <dir>` names a tree that may be another worktree. The `main-checkout`, `controller` and `role-deny` gates also read `process.cwd()` and do not test for a commit; decide whether they take the same directory in this plan or in a follow-up.

## Slices

### The rule

- `feature/the-commit-gates-match-only-the` — `makesCommit` in the domain package and the four gates calling it, with `-C` directory threading <!-- builds: makesCommit, a domain rule over the parsed command -->

## Notes

- Test table, one row per case: the five rows in Motivation, `cd x && git commit`, `git add -A && git -C y commit`, `git merge --no-commit`, `git rebase --continue`, `git rebase main` (no match), a commit message naming `git commit` (no match), and a `readShell` null fallback.
- Related: #2970 and plan PR #2971 (the bundle gate's repair text); launchers `plot-state-gate.sh` and `plot-bundle-commit-gate.sh`.
