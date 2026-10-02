---
'plot': patch
'@plot-pm/board': patch
---

`plot-open-pr.sh` opens a PR for a branch whose only earlier PR was closed unmerged, and names that closed PR on stderr and in the new PR's body. It still refuses a branch an open or merged PR carries, whatever position the host lists that row in.

Measured 2026-09-30 on `bug/a-state-sweep-is-one-request`: PR #1089 was opened, closed 38 s later, and the branch force-pushed, so GitHub refuses to reopen it. From then on every run refused `pr-exists` naming #1089 while the branch held two finished commits, and the agent stopped with `PLOT-BLOCKED`.

The shell kept the number of the first `pr-list` row whose head matched and read no `state`, although every row carries one. So `openSlicePr` saw a single number and could only answer *exists or not*. It now receives every matching row as `prs: readonly SlicePrRow[]` and decides which one carries the branch: an `OPEN` or `MERGED` row refuses wherever it sits, and a branch with only `CLOSED` rows opens, carrying their numbers in `closedPrs`. A row whose state the entry cannot read counts as `OPEN`, so a parse defect refuses rather than opening a duplicate.

<!--
plan: docs/plans/2026-10-01-a-closed-pr-carries-no-branch.md
bumps:
  skills:
    plot: patch
-->
