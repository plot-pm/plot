---
---

board: NOT STARTED reads as a tree, not as a list of rows

Three reported defects, one cause: a plan and its branches are one block
on this board, and the markup treated every row as its own unit.

**The separator divided the wrong pair.** Every row drew its own rule —
the plan row included — so the line fell between a plan and its first
branch, and no line fell between one plan and the next. Each visual
block therefore held one plan's branches and the *following* plan's
heading. `last:border-0` could not save it: a plan row is never the last
child of its own group. The rule now belongs to the group.

**The phase was on the wrong row.** It is a property of the PLAN that a
branch inherits, so the branches repeated one word down a column while
the plan row left the cell empty. That emptiness rested on an argument
that has expired — *"Approved for everything in this section"* — which
stopped being true when the section learned to hold Draft plans:
`Discovery` and `Design` now sit side by side, and they are the
difference between *needs your approval* and *ready to start*.

**So did the waiting clock.** Every branch of one plan shares one
`waitingDays` — it dates the plan's own `Approved:` record — and
repeating it says one number three times.

Only the INHERITED clock is suppressed. A deferred branch keeps its own
`ageMinutes`: an earlier version of this section erased a shelved
branch's age and PR, and `fleet.ts` still carries the warning. A property
of the plan is repetition; a property of the branch is information.

<!--
bumps:
  skills:
    plot: patch
-->
