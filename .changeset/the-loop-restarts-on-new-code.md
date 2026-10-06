---
'@plot-pm/board': minor
---

The worker loop restarts itself onto a newer bundle built on `main` while it waits for work, and once more above a 300MB resident-memory ceiling, rather than running the code it loaded at start for its whole life. A restart runs the candidate bundle's own `--self-check` first and only replaces the running process on a clean exit; a Node without `process.execve` logs the gap once and keeps running the old bundle. `PLOT_WAIT_STARTED` carries a restarted process's wait-start time across the replace, so a restart never extends `Worker bound`.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
-->
