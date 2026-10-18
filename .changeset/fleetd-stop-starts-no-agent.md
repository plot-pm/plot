---
'plot': patch
---

A stop request that arrives while a fleet scan runs now starts no new agent: `fleetAutoWrites` skips auto-dispatch once the daemon's stop flag is set, while delivery, verification and design still finish (#1577, stop-race bullet of #1526). `plot-fleetctl.sh` resolves the desk root through `pwd -P` before the estate check, so a desk reached through a symlinked `Worktree root` is no longer refused (#1586).

<!--
plan: docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md
bumps:
  skills:
    plot-fleet: patch
-->
