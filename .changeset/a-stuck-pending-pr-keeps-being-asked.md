---
'plot': patch
---

A PR whose checks finished without moving `updatedAt` now settles on the incremental PR refresh however long it has been open, instead of staying `pending` until the next whole refresh (up to 24h later). The pending-check re-ask's slow path used to stop for good once the PR's head outaged `Checks wait`; it now keeps re-asking every `PR_PENDING_REASK_SLOW_MS` regardless of head age.

<!--
plan: docs/plans/2026-10-24-the-pr-index-keeps-checks-pending.md
bumps:
  skills: {}
-->
