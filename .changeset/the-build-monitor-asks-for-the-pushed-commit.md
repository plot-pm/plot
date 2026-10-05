---
'plot': patch
---

A worker's checks wait now ends when the CI run for its pushed commit finishes. Before, `run-for-sha` could answer with the previous commit's run for several seconds after a push, and the BuildMonitor's `head moved` finding settled the desk's HEAD on that stale answer — so the wait ran to its `Checks wait` bound with no answer for the commit actually pushed.

<!--
plan: docs/plans/2026-10-05-the-build-monitor-asks-for-the-pushed-commit.md
bumps:
  skills:
    plot: patch
-->
