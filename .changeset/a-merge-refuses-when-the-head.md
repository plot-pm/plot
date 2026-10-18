---
'plot': patch
---

A Bitbucket merge through `plot-host.sh pr-merge --match-head` now refuses `head-moved` when the PR head differs from the sha the caller checked, the same refusal GitHub already gives; the controller gate and `host-pin.ts` no longer exempt Bitbucket from the pin requirement.

<!--
plan: docs/plans/2026-10-18-a-merge-refuses-when-the-head.md
bumps:
  skills:
    plot: patch
-->
