---
'@plot-pm/board': patch
---

fleetd serves its snapshot on the channel to a reader that asks for it, then one delta per changed reading. The board holds a copy and reports `current`, `resyncing`, `mismatch` or `absent` on `/api/fleet`; against a fleetd of another version it logs one line naming both protocol versions and keeps reading for itself. Nothing renders from the copy yet.

<!--
plan: docs/plans/2026-11-09-the-channel-carries-readings.md
-->
