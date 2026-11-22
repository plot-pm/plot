---
'@plot-pm/board': patch
---

The sprint, release and person cards count a Delivered docs or infra plan as delivered: `/api/fleet`'s plan index carries each plan's phase, type and non-deferred slice names, and the cards seed the plan's slices from them instead of reading "The merge reading for this sprint is missing." (#3640).

<!--
plan: docs/plans/2026-11-21-a-delivered-docs-plan-counts-as-finished.md
bumps:
  skills:
    plot: patch
-->
