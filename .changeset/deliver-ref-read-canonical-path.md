---
'@plot-pm/board': patch
---

`POST /api/deliver` reads the plan's phase at the pulse's read ref when the repo root is a symlink, instead of falling back to the stale working tree.

<!--
plan: docs/plans/2026-10-17-delivery-reads-the-delivered-plan-and.md
bumps:
  skills: {}
-->
