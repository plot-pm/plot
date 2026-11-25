---
'plot': patch
---

The board's PR age is never younger than the rows it serves. A delta read whose store fold failed recorded no snapshot reading, so the board kept the older rows, while fleetd still moved the published `prAt` to the delta's answer time. fleetd now keeps `prAt` where a delta has no fold (`answerMovesPrAt`), so the age counts from the rows the snapshot holds.

<!--
bumps:
  skills:
    plot: patch
-->
