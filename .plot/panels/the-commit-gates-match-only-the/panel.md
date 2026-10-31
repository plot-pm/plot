# Panel: the-commit-gates-match-only-the

Round 1, 2026-10-31. Subject: `docs/plans/2026-10-31-the-commit-gates-match-only-the.md` (plan PR #2984, issue #2974). Four Opus jurors, one rubric, lens as the only variable.

**Reconciliation:** `unanimous amend` (layering, safety, testability, seams).

## What each juror looked at

- **layering:** read `gate.ts`, `main-checkout-write.ts` and `shell-reading.ts`, and ran the test-table strings through `readShell` and `gitWriteDirs` built from `src/`.
- **safety:** ran `merge -X theirs`, `merge --continue`, `rebase --continue`, `cherry-pick` and `git -C <scratch> commit` against the real gates in scratch repositories.
- **testability:** ran the four gates through their launchers against fixtures, and staged a rebase replay of a receipted `State:` change.
- **seams:** ran `readShell` and `gitWriteDirs` from `origin/main` over six wrapper forms, and read `controller-gate.ts`, `phase-gate.ts` and the shell launchers.

Three of four jurors executed code. Their findings agree on every point below. No finding rests on reading alone.

## Agreed findings

1. **A commit reader exists.** `writeDirsWhere`/`gitWriteDirs` in `packages/domain/src/rules/main-checkout-write.ts` skip git's global options, join successive `-C` paths and follow a literal `cd`. `commitIndex` in `controller-gate.ts` is a second reader. The plan's claim "found no existing commit test" is false, and `makesCommit` over `readShell` would be a third reader with different semantics. (all four)
2. **The parsed rule matches less than the substring test.** `readShell` returns a non-null reading for `bash -c "git commit …"`, `sh -c`, `eval`, `command git`, `timeout 60 git`, `nice git`, `sudo git` and `xargs git`, with a first word other than `git`. The null fallback never fires for these, so the plan's "never matches less" claim is false. (all four)
3. **A PreToolUse gate cannot judge a commit-starting form.** Before plain `merge`, `pull`, `cherry-pick`, `revert` or `am` runs, the index is clean, so every gate allows. Matching them protects nothing. (all four)
4. **Matching more costs more than a read.** The `state` gate spends a single-use receipt on every call it runs on (`gate.ts:320-326`), so a matched `pull` or `merge` with a receipted change staged spends the receipt and the real commit is refused. The `phase` gate refuses on staged content (`phase-gate.ts:149`), so a matched `merge --abort` or `merge --continue` on a held branch can block a conflict repair. (safety, seams)
5. **A replayed transition is refused.** The `state` gate reads `MERGE_HEAD` and not `REBASE_HEAD`, `CHERRY_PICK_HEAD` or `REVERT_HEAD`. Once the gate runs on `rebase --continue`, a replayed receipted `State:` change is refused. Measured by testability. (safety, testability)
6. **The directory rule is wrong.** "The last `-C`" ignores git's join of successive `-C` paths and a preceding `cd`, and one line can commit in two trees. (all four)
7. **Chained adds miss `-C`.** `chainedAddsOf`/`chainedStagesOf` search for the text `git add`, so `git -C y add -A && git -C y commit` passes the `state` gate. (safety, testability)
8. **No test runs a gate.** The table tests the matcher only. Today `git -C <fixture> commit` passes each launcher, so a launcher test fails on main. (testability)
9. **Open Question 2's premise is false.** `main-checkout` already places calls through `gitWriteDirs` (`gate.ts:553-555`). Only `controller` and `role-deny` read bare `process.cwd()`. (all four)

## Disagreements

- **Initiating forms.** layering accepts matching plain `merge`/`pull` if the Changelog says the gates cannot judge them. safety, testability and seams require dropping them. The difference is finding 4: layering did not weigh receipt spending or the `phase` refusal. The amendment follows the three.
- **An unplaceable directory** (`git -C "$d" commit`, `cd "$desk" && git commit`). layering and seams: read `process.cwd()` as today and name the unplaced call on stderr. safety: print `UNVERIFIED` and never read `process.cwd()`. safety's form allows a commit that today's gates judge, so it matches less than today. The amendment follows layering and seams.

## Shared blind spot

All four lenses read the four gates and their inputs. None measured how often agents commit through each form on this estate, so the cost of a false refusal has no number. The launcher tests (finding 8) and the repair rows (findings 4 and 5) are the plan's protection against it.

## Amendments for the plan

1. Build the rule on `writeDirsWhere` with a commit predicate: export `commitDirs(command)` beside `gitWriteDirs`, one entry per committing call, and `makesCommit = (c) => commitDirs(c).length > 0`. Use one global-option set. Correct the Reuse paragraph.
2. Each gate's `wants` is `command.includes('git commit') || makesCommit(command)`. Add the wrapper rows from finding 2, each matched.
3. Match only forms whose commit the index holds at hook time: `commit` (with `--amend`), and `merge`, `rebase`, `cherry-pick`, `revert` and `am` with `--continue`. Never match `--abort`, `--skip`, `--quit` or `merge --squash`. Name the initiating forms as a known escape in Notes, with the reason. Rewrite the Changelog and Motivation to match. Drop the `commit-tree` Changelog line.
4. A directory is git's joined `-C` path over any earlier literal `cd`, as `gitWriteDirs` computes it. Each gate asks every entry and refuses when any entry refuses. An unplaceable entry reads `process.cwd()` as today and writes one stderr line naming the call.
5. The `state` gate clears a replayed transition: on `rebase`/`cherry-pick`/`revert --continue`, a transition clears when the picked commit (`REBASE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`) made the same `before -> after` change against its own parent.
6. The `phase` gate decides, in the Design, how it treats a path whose staged content equals the `MERGE_HEAD` version during `merge --continue`, so the conflict-merge repair keeps working. Add merge-in-progress rows for `phase` (held branch, implementation branch), `state` and `brief-name`.
7. `chainedAddsOf` and `chainedStagesOf` read `git [global options] add|mv` through the same reader and count an add placed in the commit's directory.
8. Add one launcher test per gate that runs `git -C <fixture> commit` from outside the fixture and expects exit 2, and a chained `git -C y add -A && git -C y commit` row that refuses.
9. Give every table row its expected pair (matches, directory).
10. Close both Open Questions: fast-forward matching is dropped (amendment 3); `controller` and `role-deny` go to a follow-up issue; `main-checkout` needs no change.
