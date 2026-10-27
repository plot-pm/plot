---
'@plot-pm/board': patch
---

Every writer of a worker pid now records that process's own start time (`ps -o lstart`) beside it — the manifest's `pid` and `wrapperPid` fields, and a new `.plot-worker.pid.startedAt` sidecar for the bare pid file — so a later reader can tell a live worker from an unrelated process that reused the same pid.

<!--
plan: docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md
bumps:
  skills:
    plot-dispatch: patch
-->
