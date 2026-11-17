---
'plot': patch
---

fleetd keeps one CI reading per `sprint/*` branch on origin in `.plot/state/base-branches/<base>.json`, so a red sprint branch holds its own PRs and `main`'s red does not.

<!--
plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md
bumps:
  skills:
    plot-fleet: patch
-->
