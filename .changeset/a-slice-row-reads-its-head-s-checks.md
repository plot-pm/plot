---
'@plot-pm/board': patch
---

A Delivery row whose PR index names an older head in `checksSha` than the branch's local tip now reads `new head, checks not yet read` in WAITING ON A MACHINE instead of repeating `checks failing`, and `stuckState` no longer reports `ci-failing` for it.

<!--
plan: docs/plans/2026-11-01-an-issue-shows-its-plan-s.md
-->
