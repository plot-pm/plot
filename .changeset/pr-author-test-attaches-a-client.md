---
'@plot-pm/board': patch
---

The board test for a card's PR author holds one SSE client open while it polls, because the board reads PRs only while a page is attached.

<!--
plan: docs/plans/2026-11-08-no-tab-no-pulse.md
-->
