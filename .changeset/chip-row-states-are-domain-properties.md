---
'plot': patch
---

The domain package gains three pure rules for the Delivery tab's chip row — `chipRow`, `sprintLineCounts`, and `filteredEstateTotals` — so the row's per-chip label, on/off state, hidden count, and disabled reason, the sprint line's own item counts, and the filtered estate's bucket totals are all decided as domain properties rather than computed in `.tsx`. `chipRow` composes the `Mine` chip's label from the reader's identity (`hostUser`, falling back to `gitEmail`) and disables it with a named reason when neither is set; `Waiting on me` is returned always-disabled, since no existing rule names what it would filter. `planStatusCounts` ports the board's existing 9-status-to-4-bucket mapping into the domain, since the domain cannot import from `packages/board`.

<!--
plan: docs/plans/2026-10-19-one-chip-row-and-a-sprint.md
bumps:
  skills:
    plot: patch
-->
