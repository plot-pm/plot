# Layering juror: the-commit-gates-match-only-the

Position: amend

The layering direction is right: a pure domain rule reads the command text, and the gate entry resolves the directory against `process.cwd()` and hands it to the `refs`, `scripts` and `plan-store` adapters. But the plan proposes a new parser over `readShell` while `main-checkout-write.ts` already holds the rule it describes: `writeDirsWhere(command, accepts)` skips git's global options, joins successive `-C` paths, follows `cd`, strips leading keywords and `env`/assignment prefixes, blanks heredoc bodies, and returns per-call directories that `mainCheckoutGateOf` resolves with `resolve(cwd, dir)` (`gate.ts:555`). The plan states that no such reader exists and that `main-checkout` reads only `process.cwd()`; both are false on `origin/main`. A second parser beside it is an undeclared duplicate with different semantics (last `-C` against joined `-C`, no `cd`, keywords kept). The slice must extend the existing walker with a commit predicate and an "unplaceable" result, not add a parallel reader. Two Changelog claims also exceed what a PreToolUse gate can see.

## Findings

1. **high** — An existing domain rule already does this, and the plan says none exists. Evidence: `packages/domain/src/rules/main-checkout-write.ts:156-180` (`writeDirOf`: `GLOBAL_VALUE_OPTIONS` skip, `-C` join, subcommand set that already contains `commit`, `merge`, `pull`, `cherry-pick`, `revert`, `am`, `rebase`), `:281-310` (`writeDirsWhere(command, accepts)` with an `accepts(sub, args)` predicate, already used twice: `gitWriteDirs` and `treeStrandingResetDirs`). Checked by reading `origin/main` and by running `gitWriteDirs` (bundled with esbuild from `src/`) on every test-table string: it returns `["/x"]` for `git -C /x commit -m y`, `[null]` for `git merge --continue`, `git -c a=b commit`, `git  commit`, `[]` for `git commit-tree abc`, `["x"]` for `cd x && git commit`, `[null,"y"]` for `git add -A && git -C y commit`, `["/a/b"]` for `git -C /a -C b commit`. The plan's "Reuse" paragraph names only `mergesBy` and `readShell`.

2. **high** — A rule built on `readShell` words as the plan states matches LESS than today, contrary to the plan's claim that it "never matches less". `readShell` keeps shell keywords and prefixes as words: `if git commit -m x` gives `["if","git","commit",...]`, `for ...; do git commit; done` gives `["do","git","commit"]`, `time git commit` gives `["time","git","commit"]`, `GIT_EDITOR=true git rebase --continue` gives `["GIT_EDITOR=true","git",...]`. The null fallback does not fire for any of these. `bash -c "git commit -m x"` and `sh -c 'cd /w && git commit -m x'` parse (not null) to one `bash`/`sh` word list, so a word-level rule misses them while `command.includes('git commit')` matches them today (checked: `includes` returns `true`). `writeDirOf` handles the first group through `programWords(withoutLeadingKeywords(words))` (`main-checkout-write.ts:157`, `ci-suite.ts:125`); neither reader handles `bash -c`.

3. **high** — The directory semantics contradict git and the existing rule. The plan takes "the last `-C`"; git joins successive `-C` paths (`git -C /a -C b` runs in `/a/b`), and `joined` (`main-checkout-write.ts:114-117`) already does that. The plan reads only `-C`, so `cd x && git commit` (a row in its own test table) would read `process.cwd()`, the wrong tree. And the plan names one directory per line, while a line can commit in two trees (`git -C /a commit && git -C /b commit`); `mainCheckoutGateOf` loops over every directory (`gate.ts:554-561`), and the four gates must do the same.

4. **medium** — An unplaceable directory is not decided. `gitWriteDirs` DROPS a call whose `-C` or `cd` argument is a parameter, substitution or quoted text (`git -C "$d" commit` and `cd "$desk" && git commit` both return `[]`, checked by run), because the main-checkout gate allows such calls by design (`main-checkout-write.ts:262-266`). A commit gate must not drop them: that is the desk-root form the master agent uses. The plan must say what such a call reads: either the gate still runs in `process.cwd()` (today's behaviour, possibly the wrong tree) or it allows with a stderr note naming the unplaced commit. Reuse needs the walker to return a third value (`unknown`) rather than omit the entry.

5. **medium** — The Changelog over-claims coverage for `git merge <ref>`, `git pull`, `git cherry-pick <c>`, `git revert <c>` and `git am`. The gates are PreToolUse and read the CURRENT index (`refs.stagedEntries()`, `gate.ts:111`; `mergeParents()`, `gate.ts:116`). Before these commands run, the index equals `HEAD` and there is no `MERGE_HEAD`, so every gate reads nothing staged and allows. The commit these commands make carries content the gate never saw. Only the forms whose commit content is already staged — `commit`, `merge --continue`, `rebase --continue`, `cherry-pick --continue`, `revert --continue`, `am --continue` — can be judged. "Over-matching is the cheaper error" is true for cost, but the Changelog sentence "run on every Bash call that makes a commit" reads as protection that the first group does not get.

6. **medium** — Open Question 2 rests on a false premise. It says the `main-checkout` gate reads `process.cwd()` and does not test for a commit. On `origin/main`, `main-checkout` reads `gitWriteDirs(command)` (which includes `commit`) and resolves each against cwd (`gate.ts:546-556`). Only `controller` (`gate.ts:668`) and `role-deny` (`gate.ts:795`, `:808`) read bare `process.cwd()`.

7. **low** — Where `-C` resolution lives is right as long as the plan keeps it in the gate. The domain may not import `node:path` (Domain purity gate, `ci.yml:1324-1333`, greps `from 'node:`), and the existing walker joins strings with `joined` and returns relative or absolute text; the gate calls `resolve(cwd, dir)`. The plan's "resolved against the session directory" in the gate matches that split. Keep it there; the rule must return text, not a resolved path.

8. **low** — The gate entry stays thin. `wants` stays a pure synchronous string function, and `main-checkout-write.ts` is already a static import of `gate.ts` (`gate.ts:16-25`), so a commit predicate there adds no new load to a call no gate wants. A new module that statically imports `shell-reading.ts` also loads nothing from the world. No adapter moves into `wants`.

9. **low** — `mergesBy` is not the shape the plan describes. It splits segments with `withoutQuotes(...).split(...)` first and uses `readShell` only where no segment answers (`controller-gate.ts:266-283`). Following "its shape" means segment-first, not readShell-first.

10. **low** — Factual checks that hold: the four `command.includes('git commit')` sites are at `gate.ts:87`, `:153`, `:232`, `:371` on `origin/main`; `plot-state-gate.sh` execs `plot-gate.mjs state`; `hooks/hooks.json` runs `plot-gates.sh` (`--all`) on every Bash call with no command prefilter, so a change to `wants` takes effect. `.claude/settings.json` does not exist on `origin/main`; the role settings live in `.claude/settings/*.json` and run `role-deny` only. Every file read the gates do inside `ask` is rooted at `root.value` (`gate.ts` lines 191, 195, 292-294, 426), so threading the directory through `refsGit({ repoRoot })` reaches them all.

## Amendments I require

A1. Replace "One rule, over the parsed command … through `readShell`" with: the rule extends `writeDirsWhere` in `main-checkout-write.ts` (or moves that walker into a shared rule module that both gates import) with a commit predicate `commits(sub, args)`: `commit`; `merge` without `--no-commit`/`--abort`/`--quit`; `cherry-pick`, `revert`, `am`; `pull`; `rebase --continue`. Name the export in the existing shape: `commitDirs(command): readonly (string | null | Unplaced)[]` plus `makesCommit = (c) => commitDirs(c).length > 0`. Correct the "Reuse" paragraph to name `gitWriteDirs`/`writeDirsWhere`.

A2. State that the directory is git's joined `-C` path over any earlier literal `cd`, exactly as `joined`/`cdOf` compute it, and that each gate loops over every returned directory (the `mainCheckoutGateOf` loop), not one.

A3. Decide the unplaceable case (`git -C "$d" commit`, `cd "$desk" && git commit`) and add both as test rows. Recommendation: run the gate in `process.cwd()` as today and write one stderr line naming the unplaced call, so nothing matched today stops matching.

A4. Keep the `includes('git commit')` substring as a floor, OR-ed with the parsed rule, so `bash -c "git commit …"`, `sh -c '…'`, `xargs git commit` and any reader gap still match. Replace "a line `readShell` returns null for falls back" with that, and add `if git commit`, `GIT_EDITOR=true git rebase --continue` and `bash -c "git commit -m x"` to the test table.

A5. Narrow the Changelog to what a PreToolUse read can judge: the gates run on `merge`, `pull`, `cherry-pick`, `revert` and `am` but read the index before the command, so they judge only the `--continue` forms and a plain `commit`. Either say this in the Changelog, or drop the pre-operation forms from the match and say why.

A6. Correct Open Question 2's premise: `main-checkout` already reads `-C`/`cd` directories through `gitWriteDirs`; only `controller` and `role-deny` read bare `process.cwd()`.

## Optional

O1. `git commit-tree` falls out of an exact subcommand comparison in the existing walker already; keep the row, drop the explanation as a design point.

O2. Add `cherry-pick --continue`, `revert --continue` and `am --continue` rows, since those are the forms the gate can actually judge.

O3. A corpus-style test that asserts `gitWriteDirs(c) ⊇ commitDirs(c)` for every table row keeps the two predicates over one walker from drifting.

## Open questions

- Fast-forward `git pull`/`git merge` matching: accept the cost. A clean index read is one `git diff --cached` per call and allows. But the plan must not count these matches as protection (A5): at PreToolUse time the gate cannot see what the merge will bring in.
- `-C` for `main-checkout`, `controller`, `role-deny`: `main-checkout` already has it, so nothing to do there. Leave `controller` and `role-deny` to a follow-up: neither tests for a commit, `role-deny` checks `gateInsideTree` against the session tree on purpose, and widening them changes refusals this plan does not test.
