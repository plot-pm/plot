---
'@plot-pm/board': patch
---

A board with no fleet and an unreachable tracker or git host now shows the open issues `issues.json` last held, aged from the index's own `at`, instead of an empty inbox — the fleet never writes from this read, and the next poll still asks the host.

<!--
plan: docs/plans/2026-10-23-board-shows-no-tickets-offline-without.md
bumps:
  skills:
    plot: patch
-->
