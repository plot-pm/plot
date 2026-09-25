---
'@plot-pm/board': patch
---

A failed scan keeps the sections the last successful scan gave. The board re-derived section membership on every render from the cached pulse, including when the scan that would have refreshed it had failed — so the banner said "showing the last successful pulse below" while the classification rules ran again over refs it had just called stale. Measured 2026-09-25: five approved, unstarted plans rendered under DONE as `merged`, with no PR and none of their code on the default branch. The arm is `branch-state.ts:264` — a claim-only branch reads `claimed` while the pulse can see its claim commit and `merged` once `commitsAhead` reports 0, which skips the `claimed` arm entirely. A row the last good scan never saw now renders unplaced: shown, but in no section, and least of all DONE.

<!--
plan: docs/plans/2026-09-25-a-stale-pulse-keeps-the-sections-it-had.md
-->
