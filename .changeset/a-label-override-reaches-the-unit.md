---
'plot': patch
---

`PLOT_FLEET_LABEL` sets the label launchd keys the supervisor by, so two checkouts can each run one. The plist template hardcoded `com.plot-pm.registryd` as its `Label`, and launchd keys a job by that string rather than by the filename, so an override renamed the file and loaded under the default label. The template now carries `__LABEL__` and `/plot-fleet --start` fills it. A unit installed before this change keeps its old label; `skills/plot/units/README.md` names the three commands that migrate it. The systemd unit has no label field and is #1053.

<!--
plan: docs/plans/2026-09-28-a-label-override-reaches-the-unit.md
bumps:
  skills:
    plot-fleet: patch
-->
