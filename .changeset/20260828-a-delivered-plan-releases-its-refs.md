---
"plot": minor
"@plot-pm/board": patch
---

A delivered plan releases the remote refs of its merged branches, after the reap.

**Why this exists**: branches are what the fleet scan actually costs. Measured
2026-08-27 across four runs — 54 worktrees/43 branches took 462.9 s, 42/43 took
51.3 s, 11/43 took 218.5 s, and 11/34 took **111.5 s**. Worktree count does not
order those runs: 11 worktrees was slower than 42. What moved reliably was
deleting nine merged branches, roughly halving the scan. Reaping clears desks;
deleting refs is what the scan notices.

**`plot-release-refs.sh` is plan-scoped, where `plot-reap.sh` is slug-blind**,
and that asymmetry is the whole safety argument. The reaper sweeps every worktree
because a removed checkout is re-creatable with `git worktree add`; a deleted ref
is not re-creatable at all. So the new script is told which plan finished and
touches only the branches that plan names — a sweep over every merged ref on the
estate would satisfy *"a delivered plan's merged branches lose their refs"* and
destroy unlanded work belonging to plans nobody delivered.

**Five guards, in the order they run**: a `deferred:`/`moved:` branch (given up,
not finished — `/plot-reconcile` needs the ref *plus* its annotation), a branch
no PR of which merged, a branch with an **open** PR, a branch checked out in any
worktree, and the default branch. The middle three were measured by hand on
2026-08-28, when ten merged refs were deleted and two deliberately kept:
`changeset-release/main` (merged, but Changesets recreates and reuses it, so a
live release PR sits on a ref whose own older PR merged) and a branch whose
worktree still held it.

**The merge gate is not a second implementation.** `pr_merged` moved out of
`plot-reap.sh` into `plot-pr-merged.sh`, sourced-not-run in the shape of
`plot-worker-state.sh`, so both scripts ask one question one way: `mergedAt` on
ANY PR, never `state` (a merged PR reports CLOSED) and never ancestry
(squash-merge leaves a branch permanently ahead of main). A host that cannot be
asked answers *not merged*, so silence keeps every ref.

**This does not break the `/plot-implement` rule** — *never delete a remote ref
another session may be reading*. Read in context that rule governs giving a
branch up, and its reason is that `/plot-reconcile` needs the ref and its
annotation to tell deliberate abandonment from a dead worker. A branch whose PR
merged is neither abandoned nor ambiguous. The rule protects **unlanded** refs;
guards 1 and 2 are that reconciliation, enforced.

**The board chains it after the reap**, which runs after the delivery: deliver →
reap → delete, each waiting on the previous one's exit rather than spawned
beside it. All six orders end with a delivered plan, no worktree and no ref, so
an end-state assertion passes for any of them — only this one never shows a
desk-less `Approved` plan, and never leaves a worktree outliving the ref it
tracks.

<!--
bumps:
  skills:
    plot: minor
-->
