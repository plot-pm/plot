---
'plot': patch
---

fleetd's merge selection applies the red hold to the PR's own base: a PR into a sprint branch is no longer held `default-branch-red` by main, and holds `base-branch-red` only where that base's own reading is settled red and fresh.

<!--
plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md
bumps:
  skills:
    plot: patch
-->
