---
'plot': patch
---

fleetd starts the repair once the first red SHA's re-run has not settled within `Checks wait` of the ask: `rerunSettledOf` answers `overdue`, measured from the record's `at`, else from `redSince`, and overdue where neither time parses. The repair attempt records `startedAt`, and the `Main repair bound` runs from it, else from `redSince`, so a repair started at the end of the wait is not reverted within a minute. Restart fleetd once after this change lands: an older fleetd reads a record whose attempt carries `startedAt` as unreadable and answers no episode until it restarts.

<!--
plan: docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md
bumps:
  skills:
    plot: patch
-->
