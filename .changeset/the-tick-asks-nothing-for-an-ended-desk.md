---
'plot': patch
---

A tick's fresh-agent step now counts every host question it asks toward the tick's reported spend.

`freshAgentDeskReads`'s `prMerged` and `prOpen` each add one to the tick's `HostTally` per question asked — including a question the tick's merge memo answers from cache rather than the host, matching the counting convention the queue and supervisor worlds already follow. `prOpen` now runs through the same `HostTally`-counted path the tick uses elsewhere, rather than an uncounted one. The port construction `startFreshAgents` acts through is extracted into `freshAgentPortsFor`, a factory called once per daemon setup rather than inlined in `run()`.

<!--
plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
bumps:
  skills:
    plot: patch
-->
