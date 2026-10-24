## Implementation brief — a-mixed-reset-leaves-the-main (wave 1: Gate)

- **Plan (canonical):** `docs/plans/2026-10-24-a-mixed-reset-leaves-the-main.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2631 merged
- **Branch:** `bug/a-mixed-reset-leaves-the-main-gate` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — `scripts/check-*.sh` gates plus the usual PR review

`bug/a-mixed-reset-leaves-the-main-brief` waits on this branch. Nothing blocks this one.

### What to build

On 2026-10-24 at 22:15 a `git reset` without `--hard` moved the main checkout's `HEAD` to `origin/main` and left the working tree 8 commits behind it: about 140 uncommitted changes (100 modified, 34 deleted, 7 untracked) that reverse 8 commits of `main`. A `git add -A` and commit there would have pushed that reversal. The fix on this branch is a domain rule that classifies a `git reset` as tree-consistent or tree-stranding, and a gate that refuses the tree-stranding form in the main checkout for every caller.

The rule goes in `packages/domain/src/rules/main-checkout-write.ts`, beside `gitWriteDirs`. The board's gate (`mainCheckoutGateOf`, `packages/board/src/server/entry/gate.ts`, around line 512) calls it. Write both as arrows. Tests: `packages/domain/test/main-checkout-write.test.ts`, plus the gate's own test file in the board package.

### Settled decisions — do not re-derive them

**The gate must refuse for a marked writer too.** `gatesMainCheckout(env)` returns false when `PLOT_MAIN_CHECKOUT_WRITER=1`, and the brief, implement, deliver, reslice and story spawns all set it. Every existing refusal is therefore skipped for the likely actor of the incident. A fix that lives only behind `gatesMainCheckout` would not have stopped 22:15. `wants` needs a second arm that ignores the marker for the tree-stranding reset. It still needs `PLOT_UNATTENDED=1`: an interactive session keeps its freedom. This is the plan's open question 2, and the marked-writer form is the only one that would have stopped the incident.

**Mixed is the default, so classify by absence.** `git reset`, `git reset origin/main`, `git reset -q`, `git reset --mixed` and `git reset -- <path>` touch the index without the tree. `--hard` is tree-consistent. `--soft` is tree-consistent for a HEAD move: index and tree stay as they were, so a following `git status` shows the diff honestly. `--keep` and `--merge` also update the tree and do not strand it. A reader that looks for `--hard` alone would call `--keep` stranding, so list the flags.

**`git reset -- <path>` and `git reset <tree-ish> -- <path>` unstage a path and never move `HEAD`.** The plan lists the form in the corpus. Decide it from the measurement: run `grep -rnE 'git( -C \S+)? reset' skills packages/*/src scripts` first. At brief time the only hit is a comment in `packages/domain/src/adapters/trees/trees-git.ts:549` ("never `git clean` or `git reset --hard`"), so no shipped script runs a mixed reset and refusing the path form costs no caller. Record the grep result in the commit message.

**Reuse the existing command reader.** `gitWriteDirs` already handles quoting, heredocs, `cd`, `-C` and leading keywords. Do not write a second tokenizer. A reset in a desk worktree (`-C <desk>`, `cd "$desk"`) stays allowed: the refusal is for the MAIN checkout only, through the same `where`/`linked` reading the gate already does. A call the text cannot place (`cd "$desk"`) stays allowed, as `gitWriteDirs` documents.

**Rules carried over unchanged:** absent is not false (an unreadable root allows, `onError: 'allow'`); read the exit code, not the emptiness. The refusal text names a form that is allowed: `git reset --hard origin/main` on files the agent owns, or a re-cut in a disposable worktree.

### Done when

The plan's slice line is the specification: a mixed `git reset` in the main checkout is refused for every caller, with a corpus of the command forms `reset`, `reset --hard`, `reset --soft`, `reset origin/main`, `reset -- <path>`. Beyond that:

- **A test with `PLOT_MAIN_CHECKOUT_WRITER=1` that expects the refusal.** An implementation that edits only the unmarked path passes every other test and does not cover the incident.
- **A test of a `reset` in a linked worktree that expects an allow.** It catches a gate that refuses every `reset` whatever the directory.
- **A test that `git reset --hard origin/main` in the main checkout is allowed for a marked writer.** It catches a gate that bans the recovery its own refusal text recommends.
- **`git -C /abs/main reset` and `cd /abs/main && git reset` are refused**, as `gitWriteDirs` already places them.

Plus: a changeset (`plot` package, description first, `bumps:` block last). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file, so it adds none.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` and never with `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/main-checkout-write.ts`, `packages/domain/test/main-checkout-write.test.ts`, `packages/board/src/server/entry/gate.ts` with its test, and one changeset. The brief and implement prompts and `skills/plot-implement/SKILL.md` belong to `bug/a-mixed-reset-leaves-the-main-brief`; leave them alone. Open question 1 (which spawn made the 22:15 commit) is not decided here. If you find a script that runs a mixed reset, report it rather than fixing it outside scope.
