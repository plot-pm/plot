---
'@plot-pm/board': patch
---

The issue index holds every open issue up to 1000 and the issues closed in the last 14 days, each set under its own `answer`, `at` and `complete`. A board with no fleet reads issues through the tracker port on its own cadence gate, and the PR pass subtracts that gate's spend; `PR_REQUESTS_PER_REFRESH` for Bitbucket falls from 4 to 3.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
bumps:
  skills: {}
-->
