---
'plot': patch
---

`readQueue` skips a plan in the `delivered` or `released` phase before it reads any of that plan's branches. A finished plan contributes no slice to the queue, so the tick no longer prints its branches held on `waits` or `not-claimable`, and the queue asks the host and git nothing about them. A plan with an empty, missing or unrecognised phase is not finished and queues as before. `FINISHED_PHASES` is now exported from `rules/eligible.ts`.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
