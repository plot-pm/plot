---
'@plot-pm/board': patch
---

The board's `/api/board` poll no longer aborts under load (issue #2083): concurrent requests now share one `buildBoard` run instead of each starting its own, and the client's board-specific timeout rises from 3.5 s to 12 s, leaving the fleet poll's 3.5 s bound untouched.

<!--
plan: docs/plans/2026-10-19-the-board-shows-no-rows-when.md
bumps:
  skills: {}
-->
