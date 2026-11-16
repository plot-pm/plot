---
'plot': patch
---

A desk's worker loop now runs `.plot/worker-prompt.sh` and reads agent charters from the main checkout, not from the desk's own branch. A desk cut before a prompt change on the default branch therefore gets the new prompt on its next prompt run. `PLOT_WORKTREE`, `PLOT-CORRECTION.md`, the brief and the plan's `agent:` annotation still come from the desk. Where git cannot name the main checkout, the loop logs one line and uses the desk's own copy.

<!--
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->
