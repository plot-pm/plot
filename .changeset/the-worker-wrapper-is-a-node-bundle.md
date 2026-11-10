---
'plot': patch
---

A new bundle, `plot-worker-wrapper.mjs`, starts a `Worker command` and writes the same desk records as the inline `sh` wrapper in `plot-dispatch.sh`: `.plot-worker.wrapper.pid`, `.plot-worker.pid`, `.plot-worker.pid.startedAt`, the manifest stamp, the WorkerMonitor line and `.plot-worker.exit`. No launch uses it yet. The process census adds row D1, one dispatch.

<!--
plan: docs/plans/2026-11-09-node-worker-wrapper.md
-->
