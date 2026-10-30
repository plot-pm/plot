---
'plot': minor
---

fleetd merges one passed slice PR per pass. The merge arm of `slicePrNext` merges a PR whose `plot/review` passed on its head, holds on a stale, red, unread or unsettled default-branch reading, on a merge in flight, on a conflict and on a missing `Merger app`, and `nextMerge` picks the lowest PR number.

<!--
plan: docs/plans/2026-10-29-fleetd-merges-slice-prs-one-at.md
bumps:
  skills:
    plot-dispatch: minor
-->
