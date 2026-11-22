---
'@plot-pm/board': patch
---

The fleet bridge and the fleetd heartbeat resolve their path from the repository's state home, so a linked worktree and its main checkout read and write the same file. Where git names no state home for a directory, a bridge read answers no bridge, a heartbeat read answers no heartbeat, a write of either answers failed, and the pulse writes no bridge; none of them falls back to the directory itself.

<!--
plan: docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md
bumps:
  skills:
    plot: patch
-->
