---
'@plot-pm/board': minor
---

The JS worker loop restarts itself on the newer bundle in this repository's main checkout. It checks once before its first pass, and between passes while it waits for work. A restart needs the main checkout on the default branch, its bundle directory clean, its `HEAD` containing the commit it was on when the loop started, and a bundle whose content differs. A loop in a free wait above 300 MB resident memory restarts on its own bundle. The candidate bundle runs `--self-check` first, and a candidate that fails it is logged once and not used. The restart keeps the pid through `process.execve`, and `PLOT_WAIT_STARTED` carries the free wait's start, so a restart does not extend `Worker bound`. On a Node without `process.execve` the loop logs that once and does not restart.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
-->
