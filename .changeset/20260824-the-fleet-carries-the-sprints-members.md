---
"@plot-pm/board": patch
---

`fleet.sprints` gains `members`: the sprint file's plan array, the same one
`board.sprints` already carries. The Agents tab reads the fleet payload, not
the board payload, so without this it cannot join on sprint membership.

<!--
bumps:
  skills:
-->
