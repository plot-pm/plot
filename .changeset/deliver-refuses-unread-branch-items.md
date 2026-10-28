---
'plot': patch
---

`/plot-deliver` now refuses a plan whose `## Branches` section names a branch in a list item no claim line resolves, instead of silently delivering with that item unread — `deliver()` gains the `slices-unread` refusal, `deliverabilityOf` and the board's `landed()` check read the same `unreadBranchItems` field, and `plot-fleet-scan.sh` passes it through to the pulse JSON so the board and delivery agree.

<!--
plan: docs/plans/2026-10-28-deliver-passes-a-plan-whose-slices.md
bumps:
  skills:
    plot-deliver: minor
-->
