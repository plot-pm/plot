---
'plot': patch
---

The merge controller refuses `unaskable` when the default-branch read fails, refuses `default-branch-stale` when the default-branch reading is older than `Checks wait`, red or green, and validates the sha argument of `plot-ask.mjs merge` as 40 hex characters. Fleetd re-asks a green default-branch head once per half `Checks wait`, so a green main keeps a fresh reading. `Checks wait` values of `0`, a negative number or a word read as the 3600 s default in every caller.

<!--
plan: docs/plans/2026-10-10-the-controllers-close-their-review-findings.md
bumps:
  skills:
    plot: patch
-->
