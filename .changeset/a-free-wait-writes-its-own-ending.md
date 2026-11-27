---
'plot': patch
---

A free agent whose wait reaches `Worker bound` now writes its own ending, `free-wait-expired` with actor `agent` and exit 124, so the supervisor no longer records the planned end as `unreadable`. The board places a clean desk with that ending in the quiet section to be reaped, `endingAction` leaves it, and a desk whose ending predates this change reads the same way.

<!--
plan: docs/plans/2026-11-27-a-foreign-slice-is-never-claimed-here.md
bumps:
  skills:
    plot: patch
-->
