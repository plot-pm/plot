---
'@plot-pm/board': patch
---

`POST /api/deliver` and the board's Deliver verdict judge a plan against the last scan that finished, rather than against the scan in progress. A fully merged plan is deliverable while the next scan runs, and the Deliver control stops flickering on every pulse. `scan-incomplete` now means that no scan has finished since the board started, or that the plan names a branch the last finished scan did not report.

<!--
plan: docs/plans/2026-10-01-delivery-reads-the-last-finished-scan.md
-->
