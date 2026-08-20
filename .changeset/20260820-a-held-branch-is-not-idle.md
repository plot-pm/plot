---
"@plot-pm/board": patch
---

board: a branch held by a local worktree is somebody working, not nobody

`WORKING` read `none — nothing to do, just look` while four agents edited files
in four worktrees, and `NOT STARTED` offered three of their branches as
*eligible — nobody has taken it*. `plot-dispatch.sh --dry-run` then offered two
already-implemented branches as dispatchable. Neither section was stale: both
read the wrong evidence.

**The no-ref arm asked only whether the tree was dirty.** Dirtiness is inverted
with respect to progress — it is brightest when least has been achieved and goes
dark the moment a commit lands — so an agent that committed and kept working
disappeared. Observed live between two pulses: `WORKING` read `(1)`, then
`none`, and the only change was an agent committing.

**`local_worktree` was the fact nobody passed.** The scan has collected it since
the wave that added it and `FleetBranchSchema` parses it at `schema.ts:700`; it
reached `rowsFromPulse` and stopped there. `classify` never saw it. So the board
computed *where this branch is checked out*, rendered the path in the row, and
still concluded nobody had taken the branch.

`local_ahead` cannot answer this, and the first attempt at this fix proved it
twice. Broadening the condition to `localAhead > 0` broke two deliberate tests —
one pinning that `open` plus unpushed commits stays `not-started`, because
commits without a worktree are a leftover local ref nobody is on. Changing
`local_ahead_of` to count against the default branch instead broke a third,
named *a MISSING upstream is detected, not read as zero*: for a branch with no
`origin/<branch>` ref the comparison fails, and the 0 it reports means **could
not compare**, not **no commits**. Both tests were right. The commit count is
blind to exactly the branches in question, and `plot-fleet-scan.sh` is
unchanged here.

A worktree exists on purpose, which is why it is the signal that says *held*
rather than merely *touched*. The note reads `held in a local worktree` when
nothing more specific is true, and dirtiness still outranks it — somebody
editing right now is the more specific fact.

Same one-directional rule as `local_dirty`, `local_ahead` and `local_locked`: it
may only lift a row out of quiet, never downgrade one. A merged branch with a
leftover worktree still reads `done`.

<!--
bumps:
  skills:
    plot: patch
-->
