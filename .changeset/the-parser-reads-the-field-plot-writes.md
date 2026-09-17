---
'plot': patch
---

`plot-plan-meta.sh` reads the phase from the field Plot's own scripts write. Front matter outranked the canonical `## Status` block, and no lifecycle script writes front matter — `plot-approve.sh` holds zero front-matter references, and the five in `plot-deliver.sh` all refuse the case rather than write it. On a plan carrying both shapes the parser therefore reported a value no transition had ever touched: measured 2026-09-17 from a real approval, `/plot-approve` wrote `State: Approved`, reported all seven steps clean, and `plot-fleet-scan.sh` went on answering `unapproved, eligible=0`, so the plan dispatched nothing. A canonical `State:`/`Phase:` now wins where both exist and `phase_alt` carries the loser, so the disagreement the delivery gate reads stays visible. The precedence moves for the phase fields only: `design_raw` and the board-facing fields keep front-matter-wins, because no lifecycle script writes any of them. Both single-shape populations are byte-identical — verified across all 295 plans on this estate — and a new contract test performs a real approval and asks the real scan, which answers `eligible=1` where the old parser answered `0`.

<!--
plan: docs/plans/2026-09-17-the-parser-reads-the-field-plot-writes.md
bumps:
  skills:
    plot: patch
-->
