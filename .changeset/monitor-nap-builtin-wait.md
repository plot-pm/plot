---
'plot': patch
---

The AgentMonitor beside every agent no longer starts a `sleep` process each second: `plot_monitor_wait` naps with `read -t 1` on a FIFO it opens once and unlinks, and falls back to `sleep 1` where the FIFO cannot be made.

<!--
plan: docs/plans/2026-11-08-monitors-nap-without-sleep.md
bumps:
  skills:
    plot: patch
-->
