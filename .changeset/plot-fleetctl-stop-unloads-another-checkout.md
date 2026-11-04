---
'plot': patch
---

`plot-fleetctl.sh --stop` now reads which checkout the resolved label's supervisor serves, twice, before unloading it — refusing outright when the job serves another checkout or is unreadable, the same check `--start` already had, closing the gap where two checkouts sharing a label let one `--stop` silently unload the other's supervisor.

<!--
plan: .plot/briefs/plot-fleetctl-stop-unloads-another-checkout.md
bumps:
  skills:
    plot-fleet: patch
    plot: patch
-->
