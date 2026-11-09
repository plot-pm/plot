---
'@plot-pm/board': patch
---

`/api/continue`, restart and fleetd's fresh-session start now start the agent through `plot-worker-start.mjs` and `plot-worker-wrapper.mjs`, the wrapper a dispatch runs. A continued or restarted desk gets the same `.plot-worker.wrapper.pid`, `.plot-worker.pid`, `.plot-worker.pid.startedAt`, manifest stamp, WorkerMonitor line and `.plot-worker.exit` as a dispatched one, and its log is appended to. The inline `sh -c` reporter and its `.plot-worker.reporter.fifo` are gone. A start the wrapper refuses, such as a wrong Node major, answers `failed` with the refusal text.

<!--
plan: docs/plans/2026-11-09-node-worker-wrapper.md
-->
