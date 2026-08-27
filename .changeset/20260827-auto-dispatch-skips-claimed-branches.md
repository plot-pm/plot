---
"@plot-pm/board": patch
---

Auto-dispatch skips claimed branches.

`planAutoDispatch` now reads `ref_held` from the pulse (published by wave 1)
to identify claimed branches, and counts only **unclaimed** branches as
startable. The budget spent on a no-op — starting a worker that would
immediately be refused by `plot-dispatch.sh` — no longer starves later plans.

A claimed branch with a live worktree was the danger case: `plot-dispatch.sh`
adopts the existing worktree rather than refusing, so the phase gate never
fires and a worker starts on already-merged work. Measured twice on 2026-08-27:
six workers on six already-merged waves, two of which opened PRs ~120 commits
behind main.

Names the branch it skipped, once per pulse — a message repeated every 5 s is
noise, not a diagnostic. The defect survived a month because a budget that buys
nothing was silent.

`plot-dispatch.sh` is unchanged: its ref-push claim stays the locking
mechanism; this change stops PLANNING spawns it would refuse.
