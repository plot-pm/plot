---
'@plot-pm/board': patch
---

A run that a board route starts now outlives a board stop or restart and records its own end, where `plot-boardctl.sh --stop` killed it with the board and left no record (#3274). The run reads its exit and output as a board run on the `command` runner does, so a usage-limit or dropped-background exit still records `1` with its reason in the log, even at status 0.

<!--
bumps:
  skills:
    plot: patch
-->
