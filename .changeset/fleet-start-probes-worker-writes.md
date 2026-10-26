---
'plot': patch
---

`plot-fleetctl.sh --start` and `plot-fleetd`'s `--once --start-agents` now run one write probe against the configured `Worker command` before a claim is ever pushed — a scratch-desk `-p` run that refuses the start, rather than loading a unit or handing a slice over, when the command cannot write. `--once` only spends the probe when a tick would actually start an agent, so it stays free on an idle estate.

<!--
plan: docs/plans/2026-10-24-an-agent-refused-every-write-ends.md
bumps:
  skills:
    plot-fleet: minor
-->
