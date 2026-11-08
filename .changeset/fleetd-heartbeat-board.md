---
'@plot-pm/board': patch
---

The board skips `plot-fleetctl.sh --status` on every refresh while fleetd's heartbeat file reads live and an init system started fleetd, and `/api/fleet` reports the heartbeat file and the channel link as two separate facts.

<!--
plan: docs/plans/2026-11-09-fleetd-heartbeat-not-data-age.md
-->
