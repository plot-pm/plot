---
'plot': minor
---

The fleet folds its open-issue read into its own file-backed index (`.plot/state/index/issues.json`), the PR pass reads that index's cadence and subtracts its spend from its own rate without moving the banner, and the board under a fleet reads the inbox from that file instead of calling `issue-list` itself.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
-->
