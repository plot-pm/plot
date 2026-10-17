---
'plot': patch
---

`plot-fleetd`'s escalation notifier now runs inside its own guard, so a `Notify command` that rejects rather than resolving `{ok: false}` no longer escapes as an unhandled rejection after the tick's own try/catch has closed — the daemon survives and takes its next tick. `EscalationMemory` now bounds how many applied rungs it holds in memory, so a long-lived daemon notifying many desks over days no longer grows that array without limit. `Checks wait` is now read once per tick and shared between its two readers, instead of two independent `plot-config.sh` spawns for the same value.

<!--
plan: docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md
bumps:
  skills:
    plot: patch
-->
