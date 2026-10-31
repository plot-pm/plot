---
'plot': patch
---

A fleetd that keeps starting scans stays the scan's owner while its bridge is older than 180 s: ownership now also holds for 180 s after the last attempt started, and the board shows the bridge's age and the fleet's last failed attempt instead of starting a second scan.

<!--
plan: docs/plans/2026-10-31-the-fleet-scan-re-reads-what.md
bumps:
  skills:
    plot-fleet: patch
-->
