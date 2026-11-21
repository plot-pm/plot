---
'@plot-pm/board': patch
---

`plot-ask.mjs merge` and `plot-ask.mjs repair-pr` run from a linked worktree read the default-branch reading and the repair record under the main checkout, where fleetd writes them. They read `.plot/state` under the worktree before, so a red default branch read as no reading. The four state files take a `StateHome`, the parent of the repository's `.git` common directory, and fleetd starts no default-branch, merge, review, fixer, repair or revert arm where it cannot tell one.

<!--
plan: docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md
-->
