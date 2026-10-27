---
'plot': patch
---

`plot-fleetctl.sh --start` and `plot-fleetd`'s `--once --start-agents` now run one write probe against the configured `Worker command` before a claim is ever pushed — a scratch-desk `-p` run that refuses the start, rather than loading a unit or handing a slice over, when the command cannot write. `--once` only spends the probe when a tick would actually start an agent, so it stays free on an idle estate. The shipped `worker-prompt.sh` template prints every flag of its launch line under `PLOT_PRINT_INVOCATION=1`, `--permission-mode bypassPermissions` included, because the print and the launch read the same two arrays. An estate that installed the template earlier keeps a print without that flag, and its probe answers `no`.

<!--
plan: docs/plans/2026-10-24-an-agent-refused-every-write-ends.md
bumps:
  skills:
    plot-fleet: minor
    plot: patch
-->
