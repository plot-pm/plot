---
'@plot-pm/board': patch
---

The quiet-kind invariant test selects violators by a row's `quietKind` and `group` over `rowsFromPulse` output, not by note text, so a reworded `quietNote` sentence no longer empties it. Two `fleet.ts` comments and the QUIET table in `docs/board-domain-model.md` now state that `abandoned` and `orphaned-claim` rows sit in QUIET.

<!--
plan: docs/plans/2026-11-21-board-readings-take-the-domain-answer.md
bumps:
  skills:
    plot: patch
-->
