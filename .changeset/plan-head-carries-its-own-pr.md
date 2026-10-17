---
'plot': patch
'@plot-pm/board': patch
---

A plan's head row now carries a link to the plan's own idea-branch PR, ahead of its branch link, where one exists — fixing #1760 and #1742. The head's tally no longer counts the plan's own row among the rows it heads, so a plan with two branches now reads `(2)` instead of `(3)`. `AgentList.tsx` now reads a plan's slice groups from the one `planGroupShape` computation instead of recomputing them a second time, so the two cannot drift apart.

<!--
plan: docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md
bumps:
  skills:
    plot: patch
-->
