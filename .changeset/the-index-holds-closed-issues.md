---
'@plot-pm/board': patch
---

The issue index holds every open issue up to 1000, read page by page, and the issues closed in the last 14 days, each set under its own `answer`, `at` and `complete`. The index's `requests` counts the pages a pass read, one per 100 rows and at least one per read, so the issue gate spaces its passes to 30 requests an hour. A board with no fleet reads the same rows through the tracker port on its own cadence gate, keeps them unfiltered in memory, and the PR pass subtracts that gate's spend; `PR_REQUESTS_PER_REFRESH` for Bitbucket falls from 4 to 3. Restart the board and `plot-fleetd` together: the issue index schema is strict, so a board still running the earlier code rejects a file that carries `closed` and shows no issue index.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
bumps:
  skills: {}
-->
