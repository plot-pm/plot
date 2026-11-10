---
'plot': patch
---

fleetd writes the AgentMonitor's findings (`owes an answer`, `holds unlanded work`, `owes a review`, `owes a gate`) from the readings its scan already takes, and asks the host one `pr-state` per agent end. With no live fleetd heartbeat, the worker wrapper runs that final pass itself when its agent ends. No desk starts `plot-agent-monitor.sh` any more: the script, its README row, `deskMonitorsShell.start`, the monitor nap in `plot-monitor-subject.sh` and `plot-dispatch.sh --monitors` are removed.

<!--
plan: docs/plans/2026-11-09-liveness-token.md
-->
