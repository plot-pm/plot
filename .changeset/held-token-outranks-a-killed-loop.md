---
'plot': patch
---

A held liveness token outranks a current exit record of 128 or more. A loop killed under a live wrapper leaves `.plot-worker.exit` 137 while its harness still holds the token; that desk now reads `running` (`live` where the recorded pid answers, `stray-holder` otherwise) until `Worker bound` from `startedAt` has passed, and is no longer offered a restart beside the working harness. An exit record below 128, and any exit record beside a released token, keeps its answer. `plot_worker_state` and `plot_worker_readings` read the token for that one case and give the same answer as `workerLiveness`.

<!--
plan: docs/plans/2026-11-09-liveness-token.md
-->
