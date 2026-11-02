---
'plot': patch
---

A role start that the CLI refuses with "--agent '<role>' not found" now records a failed start that spends no fixer attempt and holds the head once, and main-repair records `start-failed` and holds the episode after a second refusal.

<!--
plan: docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md
bumps:
  skills:
    plot: patch
-->
