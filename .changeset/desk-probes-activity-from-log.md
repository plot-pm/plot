---
'plot': patch
---

The agent loop's idle check reads `.plot-worker.log` first and reads the process table with one `ps` only when the log did not move, instead of two `ps` samples 400 ms apart. A still log with the agent's CPU time moving does not end the prompt, and a `quiet` ending's `.plot-worker.ending.json` carries the check's log size, log mtime and CPU delta.

<!--
plan: docs/plans/2026-11-09-desk-probes-in-domain.md
-->
