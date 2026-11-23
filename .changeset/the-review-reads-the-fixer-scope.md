---
'plot': minor
---

fleetd's automatic review now starts on every open, non-draft PR into the default branch or a `sprint/` branch that the fixer may act on, not only on the active sprint's slices. A PR that no agent owns waits one hour after a person's last push, and a head the fixer pushed is reviewed at once. A repair or revert PR that the repair record names is still reviewed. The merge pass keeps the sprint scope. The scope rule's names change from `fixerScope`, `fixerScopeRow` and `fixerOwner` to `fleetScope`, `fleetScopeRow` and `fleetOwner`.

<!--
plan: docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md
bumps:
  skills:
    plot: minor
-->
