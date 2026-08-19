---
"@plot-pm/board": minor
---

board: a plan row is not a branch row, and the grid says so

A plan row borrowed the branch tracks, and the two then began at the same
x. Measured on screen before the change: the plan name and the branch
name below it both started at 222px, so eight sibling plans in NOT
STARTED read as a nesting rather than as a list.

The row now has its own proportions — `PLAN_ROW_TRACKS`, four cells for
the four things it carries: the shared marks column, the name, the wave
summary and the clock. No phase track (the phase rides in the name cell,
keeping its `data-phase`), no PR cell, no actions cell. Dispatch is per
branch and wave, so a control there would have to guess which wave it
meant, and an empty track to hold nothing is what this row just stopped
doing.

Measured after: the plan name begins at 217px and the branch name at
481px. Branch rows are untouched and still align column-for-column across
all five sections — `[189,217,309,481,1423,1659,1711]` in every one — the
property #175 established and this does not spend.

An unplanned improvement worth naming: plan names are no longer
truncated. `the-repair-exists-but-n…` in a 10rem branch track is now
`the-repair-exists-but-nothing-calls-it` in a `1fr` one.
