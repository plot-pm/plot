---
'@plot-pm/board': minor
---

A slice that names no branch reads `empty` rather than `complete`. `sliceVerdict`'s first test was `outstanding === 0 → complete`, sitting above the phase check and beyond correction by anything downstream — so a `## Slices` heading carrying only prose asserted work that was finished and had never existed. `allSlicesMerged` skipped the same shape with `continue`, and the two rules disagreed about one plan: one reported the heading finished while the other refused to count it, which let a plan read deliverable on work nobody did.

`SliceReadings` gains a required `branches` count, which is the fact `outstanding` cannot carry — *all merged* and *none named* both count zero, and a defaulted field would have handed the permissive answer to a caller that forgot. `SliceVerdict` gains `empty` as a fifth word rather than borrowing a fourth: it resolves by editing the plan, which is neither what `blocked` resolves by nor what `unapproved` does.

The new test is decided after `FINISHED_PHASES` and before the approval test. A released heading is history nobody can act on, and approving a plan does not give a heading a branch. `empty` does not advance the fold, so a plan's second slice is no longer offered as startable on the strength of a first that landed nothing.

Measured 2026-09-06 across 474 slices in 207 plans: 22 branchless slices, every one on a Released or Superseded plan, and no active plan of either shape. Live in the code and dormant in the estate. No plan file is rewritten.

<!--
bumps:
  skills:
    plot: patch
-->
