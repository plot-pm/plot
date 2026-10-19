---
'@plot-pm/board': minor
---

The Delivery tab's sprint card and «Only my work» checkbox — two cards in two visual styles, roughly 200px tall — are replaced by one row of toggle chips (`This sprint`, `Mine (<identity>)`, `Waiting on me`), a line per Active sprint naming only that sprint's own item counts, and the estate totals at the row's right end (#2080). Every chip's label, on/off state, hidden count and disabled reason is computed by `chipRow()` in `@plot-pm/domain`; the new `DeliveryFilters` component only renders what the rule returns. The row wraps without horizontal scroll at 375px.

<!--
plan: docs/plans/active/one-chip-row-and-a-sprint.md
bumps:
  skills:
    plot: patch
-->
