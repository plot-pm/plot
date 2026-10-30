---
'plot': patch
---

An unattended caller can no longer merge, continue, or release a plan. `merge`, `continue`, `restart`, and `release` now read a typed `caller` (`person` | `unattended` | `fleetd`) in place of the ad-hoc `unattended` boolean, and `release` refuses both `unattended` and `fleetd` outright — the one workflow where fleetd gets no exception.

<!--
plan: docs/plans/2026-10-29-fleet-roles-are-declared-agents.md
bumps:
  skills:
    plot: patch
-->
