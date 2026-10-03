---
'plot': patch
---

The board no longer repairs a bundle conflict, and an artifact-only conflict names the restore command instead. `plot-resolve-artifact.sh` is removed along with its resolver module, the `Repair` schema and display, and `PLOT_BOARD_REPAIR`: slice 2 of `a-branch-carries-no-built-bundle` had already switched the automatic write off since a PR must never carry a generated bundle, so nothing produced the conflict the repair existed to fix. `artifact-conflict` keeps its classification — the row still shows it as an exception — but now prints the merge-base `git checkout` restore a person runs once, never a pending repair.

<!--
plan: docs/plans/2026-10-02-a-branch-carries-no-built-bundle.md
bumps:
  skills:
    plot: patch
-->
