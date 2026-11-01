---
'plot': patch
---

A SIGTERM, SIGINT or SIGHUP that reaches a caller of `boundedRun` in the same event-loop turn as the run's child ending now still ends the caller. The adapter keeps one signal listener per process and counts live runs, where it removed the last listener when a run finished and Node dropped the queued signal.

<!--
plan: docs/plans/2026-11-01-the-bounded-run-group-stop-test.md
bumps:
  skills:
    plot: patch
-->
