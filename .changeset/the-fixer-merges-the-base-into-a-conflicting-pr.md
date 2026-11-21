---
'plot': patch
---

fleetd's fixer starts on a conflicting PR that no live agent owns: a new `conflict` finding, keyed on the PR's head and the base tip, briefs the fixer to merge `origin/<base>` into the branch, restore generated bundles from the merge base and push, with 2 attempts per PR. The merge arm's `conflicting` hold now compares against the stored lowercase word, so a conflicting PR no longer reaches the merge.

<!--
plan: docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md
bumps:
  skills:
    plot: patch
-->
