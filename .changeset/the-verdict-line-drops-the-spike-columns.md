---
'@plot-pm/board': patch
---

`plot-verdicts.mjs` reads exactly three columns per slice line, `outstanding<TAB>phase<TAB>states`, and refuses a batch holding a longer line with exit 2. The three optional spike columns it accepted had no producer: the domain walk in `slice-readings.ts` decides a Design plan's spike exception.

<!--
plan: docs/plans/2026-11-21-board-readings-take-the-domain-answer.md
bumps:
  skills:
    plot: patch
-->
