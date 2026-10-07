---
'@plot-pm/board': minor
---

The board stops reading and writing `buildMonitorPid`. The manifest schema, `continue`, the registry, and the manifest-stamp helper all drop the field — a manifest that still carries one from before this change parses without it rather than refusing. `entry/worker-loop.ts` now writes its own CI-wait finding directly instead of waiting on a BuildMonitor process that no longer exists.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
-->
