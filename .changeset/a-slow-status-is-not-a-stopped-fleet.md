---
'plot': patch
'@plot-pm/board': patch
---

The board no longer reads a `/plot-fleet --status` run it cut off at its time limit as a stopped fleet: the run's `supervisor=` summary field decides, and a run with no summary reads as unknown. `--status` bounds each `lsof` working-directory lookup to 2 s in total and prints `cannot determine` for a lookup that does not answer in time.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
