---
'plot': minor
---

fleetd's fixer now acts on every open, non-draft PR into the default branch or a `sprint/` branch, not only on the active sprint's slices. A PR that no agent owns waits one hour after a person's last push. A release PR, a plan PR, a repair or revert PR, a PR whose base or owner cannot be read, and a PR into any other base stay out of scope and say why.

<!--
plan: docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md
bumps:
  skills:
    plot: minor
-->
