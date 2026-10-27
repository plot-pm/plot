---
'plot': patch
---

`plot-fleetctl.sh --start` and `plot-fleetd`'s `--once --start-agents` now run one write probe against the configured `Worker command` before a claim is ever pushed — a scratch-desk `-p` run that refuses the start, rather than loading a unit or handing a slice over, when the command cannot write. `--once` only spends the probe when a tick would actually start an agent, so it stays free on an idle estate. The shipped `worker-prompt.sh` template prints every flag of its launch line under `PLOT_PRINT_INVOCATION=1`, `--permission-mode bypassPermissions` included, because the print and the launch read the same two arrays. A `.plot/worker-prompt.sh` whose print omits that flag, or that has no print block, is not probed: the start proceeds, and `--start` and fleetd name the fix, which is to copy the print block and launch line from the template. An empty or `none` `Worker command` is not probed and does not refuse `--start`.

<!--
plan: docs/plans/2026-10-24-an-agent-refused-every-write-ends.md
bumps:
  skills:
    plot-fleet: minor
    plot: patch
-->
