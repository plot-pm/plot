---
'@plot-pm/board': patch
---

A one-slice plan states its slice's verdict once per section: on the slice row where that row prints it, and on the plan row where the slice row shows a branch's own PR word or is folded away. Measured 2026-09-30, `a-cold-bitbucket-board-buys-the-whole-list` rendered `Testing complete` on its plan row and `complete` on its slice row in DONE — the plan row's rule rested on a premise that a one-slice plan renders no slice row, which stopped being true when slice rows returned for every plan.

<!--
plan: docs/plans/2026-09-30-a-plan-row-says-its-verdict-once.md
-->
