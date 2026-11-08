---
'@plot-pm/board': patch
---

A run that a board route starts now outlives a board stop or restart and records its own exit code, where `plot-boardctl.sh --stop` killed it with the board and left no record (#3274).

<!--
bumps:
  skills:
    plot: patch
-->
