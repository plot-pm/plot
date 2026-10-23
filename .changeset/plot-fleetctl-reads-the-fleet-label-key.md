---
"plot": patch
---

`plot-fleetctl.sh` resolves its supervisor label from `PLOT_FLEET_LABEL`, then the `Fleet label` config key, then the `com.plot-pm.fleetd` default — it previously ignored the key entirely, so a checkout that declared one still read whichever supervisor happened to be loaded under the hardcoded default. Docs in `skills/plot-fleet/SKILL.md`, `skills/plot/units/README.md` and `skills/plot/SKILL.md` now state the precedence.

<!--
plan: docs/plans/2026-10-23-plot-fleetctl-ignores-the-fleet-label.md
bumps:
  skills:
    plot: patch
    plot-fleet: patch
-->
