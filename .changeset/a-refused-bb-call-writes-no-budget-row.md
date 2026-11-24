---
'plot': patch
---

A `bb` call that exits 75 on the hourly ceiling or on a pause after an earlier 429 sends no request, and `plot-host.sh` no longer writes a `budget.tsv` row for it. A 429 the host sent still writes one row, and the caller still reads `bb`'s stderr (#3690).

<!--
plan: docs/plans/2026-11-23-a-refused-bb-call-writes-no-budget-row.md
bumps:
  skills:
    plot: patch
-->
