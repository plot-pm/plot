---
"plot": patch
"@plot-pm/board": patch
---

plot-fleet-scan: report `held` — a worktree holds a branch whose tip has not merged

The board reported `WORKING: none — nothing to do, just look` while four agents
were editing files in four worktrees, and offered three of their branches as
*"eligible — nobody has taken it"*. Both halves are correct readings of the wrong
evidence: `WORKING` inferred activity from an uncommitted diff, `NOT STARTED`
inferred freedom from an absent claim ref, and a branch held by an agent that had
committed satisfied both.

The fact nobody recorded is **who holds this branch**. The scan already had every
ingredient to answer it: `git worktree list` names the worktree checked out on
each branch here, and the ancestry walk already computes whether a tip has
merged. This adds one derived field, `held`, that is the AND of the two:

    held = (a worktree here has the branch checked out) AND (its tip is not merged)

**Why the AND, and not just `local_worktree`.** The worktree path alone already
travels on the row, but it also fires on a CLEAN worktree left on a branch whose
work has *landed* — a leftover directory, of which there are several on any
machine that has run a fleet. Lifting that to WORKING is the merged-leftover
misread. `local_worktree` answers *where is this checked out*; `held` answers *is
that checkout somebody holding the branch*, and the merged-tip exclusion is the
whole difference between the two.

**Additive, never a downgrade.** `held` can only be true where a worktree is
present, so every branch on every other machine — every detached worker, every
teammate's laptop, every CI run — reports `held: false` and answers from its refs
exactly as before. The claim ref stays the primary, cross-machine signal: worktree
evidence can move a branch from free to held, never the reverse. A claim ref with
no worktree here still reads `claimed`.

**It is reported, never fed back into the wave arithmetic.** A wave still settles
on `merged` alone; a held branch neither completes its own wave nor opens the
next. Verified: a held, unmerged branch keeps its wave eligible and the next wave
stays blocked behind it.

The field defaults to `false` in `FleetBranchSchema`, so a pulse from an older
scan still validates — absent and "nothing here holds it" are the same statement.
The board consumers that read it (WORKING, NOT STARTED, and the dispatch gate)
are separate branches of the governing plan; this branch only produces the fact.

Tests (`test/reconcile/fleet.test.mjs`): a committed-and-clean worktree reads
held; a dirty worktree reads held; a clean worktree on a merged branch does not;
a claim ref with no worktree still reads claimed and not held; a branch with no
worktree reports held false; holding a branch does not change its wave
eligibility.

<!--
bumps:
  skills:
    plot: patch
-->
