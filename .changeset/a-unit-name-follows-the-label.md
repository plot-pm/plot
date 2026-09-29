---
'plot': patch
---

On Linux, `/plot-fleet` derives the systemd unit name from `PLOT_FLEET_LABEL`, so two checkouts install two units instead of overwriting one. The default label keeps `plot-registryd.service`, so an existing install is unchanged. Any other label loses a leading `com.plot-pm.registryd.`, has each character systemd refuses in a unit name replaced by `-`, and gains the prefix `plot-registryd-`. `--start`, `--status` and `--stop` all use that name, so the already-loaded refusal no longer refuses a second checkout because the first checkout's unit is active. A unit installed under an override before this change keeps the default name: run `/plot-fleet --stop` under the label it was installed with, then `/plot-fleet --start`.

<!--
plan: docs/plans/2026-09-29-a-unit-name-follows-the-label.md
bumps:
  skills:
    plot-fleet: patch
-->
