---
'plot': patch
---

fleetd re-runs a red PR's failed CI jobs once per head before it starts a CI-red fixer. The re-run spends no fixer attempt; the fixer record keeps it under `reruns`, and a `failing` row read inside `Checks wait` after the re-run holds as `rerun-running` until a `pending` or `green` reading clears it. A second red on the same head starts the fixer, and the fixer brief says whether the re-run ran.

<!--
plan: docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md
bumps:
  skills:
    plot: patch
-->
