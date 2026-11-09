---
'@plot-pm/board': patch
---

While fleetd's heartbeat is live and the channel holds a current snapshot, the board's refresh installs the view fleetd sent and starts no process: no scan, no branch, release, unmerged or question read, no registry probe and no PR read or reader. A new snapshot generation re-derives the view and sends one event to the page. With a stale heartbeat, a version mismatch or no tab, the board reads for itself as before.

<!--
plan: docs/plans/2026-11-09-board-reads-the-channel.md
-->
