---
'plot': patch
---

A refused or failed fleet-scan listing (a GitHub host read that comes back null, or a Bitbucket sweep whose reading reports `throttled`/`secondary`/`failed`) now opens a bounded, growing back-off instead of retrying every beat — at most 8 listing attempts an hour, down from 48–362. The scan itself never stops: it still runs every beat, hands the shell its carried listing, and still writes the bridge while the back-off holds.

<!--
plan: docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md
bumps:
-->
