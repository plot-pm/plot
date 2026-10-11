---
'plot': patch
---

The old-label migration decision moves out of `plot-fleetctl.sh` into the domain rule `oldLabelAction`, reached through the new bundle `board/plot-old-label.mjs`. A unit loaded under `com.plot-pm.registryd` that serves this checkout is unloaded and removed, one serving another checkout is left, and one whose checkout cannot be read refuses; a bundle that cannot be asked also refuses. The 11 `printf` messages that escaped a quote as `'"'"'` use double-quoted formats. `unit_name` files a label under neither `com.plot-pm.fleetd` nor `com.plot-pm.registryd` as `plot-fleetd-<label>`, where it was `plot-registryd-<label>`; `com.plot-pm.registryd.*` labels keep `plot-registryd-`. `supervisor_bundle_path` names its awk variable for the bundle path it prints.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
