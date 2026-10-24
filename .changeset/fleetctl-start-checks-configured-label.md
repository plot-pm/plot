---
'plot': patch
---

`plot-fleetctl.sh --start` now also checks whether the hardcoded default label `com.plot-pm.fleetd` is loaded and serving this checkout, when a `Fleet label` config key has resolved `$LABEL` away from it. A checkout that declared the key but still has a supervisor loaded under the old default was invisible to the existing check, which only asked about the resolved label — `--start` would load a second supervisor, and two supervisors would watch one estate's queue concurrently. The refusal now names whichever label is actually taken.

<!--
plan: docs/plans/delivered/plot-fleetctl-ignores-the-fleet-label.md
bumps:
  skills: {}
-->
