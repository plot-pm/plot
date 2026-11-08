---
'@plot-pm/board': patch
---

The board skips `plot-fleetctl.sh --status` on every refresh while fleetd's heartbeat file reads live, every loop it reports passed within its bound, and an init system started fleetd (for launchd, `XPC_SERVICE_NAME` equals the fleet label). A loop that stopped passing sends the board back to the script, which reports the tick age behind the "fleet silent" warning. `/api/fleet` reports the heartbeat file and the channel link as two separate facts.

<!--
plan: docs/plans/2026-11-09-fleetd-heartbeat-not-data-age.md
-->
