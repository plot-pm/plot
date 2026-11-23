---
'plot': patch
---

fleetd counts its Bitbucket requests in `bb`'s own ledger, so `bb` and fleetd share one hourly budget and one pause after a 429 per account. The board names the cause of a Bitbucket throttle (this machine's ceiling, `bb`'s pause, or the host) and shows the predicted Bitbucket bucket from that ledger.

<!--
plan: docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md
bumps:
  skills:
    plot: patch
-->
