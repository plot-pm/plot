---
'plot': patch
---

`plot-fleetd` reads the default branch's CI into `.plot/state/default-branch.json` and holds the queue on `default-branch-red` while the newest settled commit is red. The shell gains `plot-host.sh runs-for-sha <branch> <sha>`, which lists every workflow run of one commit.

<!--
plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md
bumps:
  skills:
    plot: patch
-->
