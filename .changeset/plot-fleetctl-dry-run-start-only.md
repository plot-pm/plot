---
'plot': patch
---

`plot-fleetctl.sh --dry-run` now refuses every mode but `--start`, read from the final mode the last-mode-wins parser settles on — closing the gap where `--stop --dry-run` signalled every agent, unloaded the supervisor, and removed the start marker under a flag that promised nothing was done (#3099).

<!--
plan: .plot/briefs/plot-fleetctl-stop-ignores-dry-run.md
bumps:
  skills:
    plot-fleet: patch
    plot: patch
-->
