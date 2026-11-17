---
'plot': patch
---

A red sprint base admits its own repair PR: fleetd records a per-base repair record on a green-to-red change, `plot-ask.mjs repair-pr` names the PR on that base's record, and the merge arm admits it from a `bug/sprint-repair-<12 hex>` branch while every other PR into the base holds.

<!--
plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md
bumps:
  skills:
    plot: patch
-->
