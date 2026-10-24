# A mixed reset leaves the main checkout's tree behind its HEAD

> An unattended agent recovered from a rejected push with a non-hard `git reset` in the main checkout, which left the working tree 8 commits behind `HEAD`.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2630
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2631 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/a-mixed-reset-leaves-the-main-gate`

## Changelog

- An unattended agent that recovers from a rejected push no longer leaves the main checkout's working tree behind its `HEAD`.

Board impact: none. The change touches agent prompts, one domain rule and its gate, not the plan format or the board payload.

## Motivation

On 2026-10-24 at 22:15 a `git reset` without `--hard` moved the main checkout's `HEAD` to `origin/main` and left the working tree at the old commit. The checkout then showed about 140 uncommitted changes (100 modified, 34 deleted, 7 untracked) that together reverse 8 commits of `main`. A `git add -A` and commit in that checkout would have pushed that reversal to `main`. Nothing reached the remote; the stray state is saved to a patch and the checkout is fast-forwarded.

Evidence from the main checkout's reflog:

- `origin/main` already held a brief for the same slug (3badb5a70, 22:09:28). The commit at 22:15:09 (91b537837) was a second brief commit, made on a `HEAD` 8 commits behind `origin/main`.
- Its push did not land: 91b537837 is on no remote branch.
- 30 seconds later `HEAD` moved to `origin/main` with `reset: moving to origin/main`. The working tree kept the files of the old `HEAD` plus the stale brief.
- No code under `packages/*/src` or `skills/plot/scripts/` runs a non-hard `git reset`, and no `/api/implement` log names the slug. The likely actor is an unattended implement or brief agent that writes in the main checkout and recovers from a rejected push with `git reset origin/main`. This is a hypothesis; slice 1 confirms or refutes it.

Three defects combine:

1. The brief step commits on a stale `HEAD` without first fetching `origin/main`.
2. The brief step writes a second brief when `origin/main` already holds one.
3. The recovery from a rejected push is a mixed reset, and the main-checkout gate does not stop it: `reset` is in `MUTATING_GIT_SUBCOMMANDS` (`packages/domain/src/rules/main-checkout-write.ts:39`), but `gatesMainCheckout` returns false for an agent marked `PLOT_MAIN_CHECKOUT_WRITER=1`, so the marked writers pass every mutating call.

## Design

### Approach

Expected behaviour, from the issue:

- A write in the main checkout starts from a fresh `origin/main`, not from a stale `HEAD`.
- An agent that recovers from a rejected push leaves the working tree consistent with `HEAD`: it re-cuts in a disposable worktree, or resets with `--hard` only on files it owns. It never runs a mixed reset that strands the old tree.
- The brief step finds the brief already on `origin/main` and writes no second commit.

Design direction, per the layering rule in `CLAUDE.md` (a gate over a rule):

- Add a domain rule next to `main-checkout-write.ts` that classifies a `git reset` as tree-consistent (`--hard`, or `--soft` on a path-free HEAD move the caller owns) or tree-stranding (mixed, the default). The gate refuses the tree-stranding form in the main checkout for every caller, including a marked main-checkout writer.
- Change the brief and implement prompts and `skills/plot-implement/SKILL.md` so the commit step fetches first, checks whether `origin/main` already holds the brief, and on a rejected push re-cuts in a disposable worktree instead of resetting.

### Open Questions

- [ ] Which spawn made the 22:15 commit? The `Brief command`, `Implement command` and the implement run all set `PLOT_MAIN_CHECKOUT_WRITER=1`; the session transcript or process log for 2026-10-24 22:15 decides.
- [ ] Should the gate refuse a mixed reset for a marked writer, or only for the unmarked agent it already covers? Refusing for the marked writer is the only form that would have stopped this incident.
- [ ] Does any existing script legitimately run `git reset` without `--hard` in the main checkout (for example `git reset -q` to unstage)? Measure with `grep -rn 'git reset' skills/ packages/*/src` before the gate lands.

## Slices

### Gate

- `bug/a-mixed-reset-leaves-the-main-gate` — refuse a mixed `git reset` in the main checkout for every caller, with a corpus of the command forms (`reset`, `reset --hard`, `reset --soft`, `reset origin/main`, `reset -- <path>`) <!-- builds: a reset classifier in main-checkout-write.ts --> → #2640

### Brief step

- `bug/a-mixed-reset-leaves-the-main-brief` — the brief and implement steps fetch before committing, skip the commit when `origin/main` holds the brief, and re-cut in a disposable worktree after a rejected push <!-- waits: bug/a-mixed-reset-leaves-the-main-gate -->

## Notes

- Source: issue #2630 (https://github.com/plot-pm/plot/issues/2630). Created from the issue by `/plot-idea`; the issue is not modified.
- Related: `docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md` (#2311) introduced the main-checkout gate.
