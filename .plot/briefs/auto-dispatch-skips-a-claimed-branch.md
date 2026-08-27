## Implementation brief — a-claimed-branch-is-not-startable (wave: Spent)

- **Plan (canonical):** `docs/plans/2026-08-25-a-claimed-branch-is-not-startable.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/auto-dispatch-skips-a-claimed-branch` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 2 of 2.** It consumes the pulse field the `Seen` wave publishes, so it
cannot start until `Seen` merges — the fleet enforces that ordering.

### What to build

`planAutoDispatch` counts only **unclaimed** branches as startable, and names the
claimed ones it skipped.

### The danger case is the one to assert

`Done when` item 6 exists because item 1 does not reach it. Item 1 tests budget
allocation with no worktree present; the harm happens where a worktree SURVIVES.

There, `plot-dispatch.sh` does not refuse — it prints `reusing existing worktree
for <branch>` and **adopts** it, so the phase gate never fires and a worker starts
on merged work. Measured twice on 2026-08-27: six workers on six already-merged
waves, two of which opened PRs ~120 commits behind main (**#473**, **#476**).
Either would have reverted that work if the auto-merger had taken it green. The
first cycle also exhausted GitHub's secondary rate limit — eight concurrent
workers against a cap of seven, three doing nothing that needed doing.

**A fix asserted only against the no-worktree case passes items 1-5 and leaves
the revert risk exactly where it is.**

### The decisions the plan settles — do not re-derive them

**The claim fact comes from the pulse**, published by the `Seen` wave. Do not
re-derive it here and do not call the host — two answers to one question is the
duplication this repo keeps removing.

**Name the branch that held the budget** (item 4), **once per pulse at most** — a
message repeated every 5 s is noise, not a diagnostic. This matters: the defect
survived a month because a budget that buys nothing is silent. `dispatched=0
skipped=0` is an empty set that says nothing about what it filtered.

**`plot-dispatch.sh` is UNCHANGED** (item 3). Its ref-push claim stays the
locking mechanism; this plan stops PLANNING spawns it would refuse, and does not
move the refusal.

**Do not drop the claim when a PR closes.** `plot-dispatch.sh` deliberately never
deletes a remote ref another session may be reading, and `/plot-reconcile` owns
cleanup using the plan's own `deferred:`/`moved:` annotations to tell abandonment
from a dead worker. A closed PR is not, by itself, abandonment — that decision
belongs to a person.

**Do not count claimed branches against the cap.** They occupy no process and no
worktree. The cap is about machines; this is about budget spent on a no-op.

**Do not order plans by recency.** Tempting, since file order is what made the
original starvation permanent. Rejected: it treats the symptom — a claimed branch
would still consume budget, just from a different plan each pulse.

**Reaping is a second-order fix and does not replace this one.**
`plot-reap.sh` would remove those leftover worktrees but currently refuses 11 of
them (*"unlanded work — no merged PR"*), because squash-merge leaves a branch
permanently ahead of main. Narrowing the population is not the same as not
counting a claimed branch startable.

### Done when

All 7 items, and **item 6 is the one that proves this wave worked**: a claimed
branch with a live worktree is not counted startable.

Plus: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green;
artifact rebuilt and committed if `packages/board` changes (`pnpm build:board`
from the repo root); a changeset with `'@plot-pm/board': patch` frontmatter;
Node 24; `trash` not `rm`.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)`. Push
your first real commit as soon as it exists.

### Scope guard

Owns `packages/board/src/server/auto-dispatch.ts` and its tests. The pulse field
belongs to `Seen`; `plot-dispatch.sh` belongs to nobody in this plan. Rebase onto
current main before you start.
