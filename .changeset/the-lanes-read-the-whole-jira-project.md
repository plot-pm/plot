---
'plot': minor
'@plot-pm/board': patch
---

A Jira `Ticket prefixes` declaration turns both the open and closed `issue-list` reads project-wide, dropping the `assignee = currentUser()` clause so the lanes show every ticket of the named projects rather than only the reader's own; a repository with no `Ticket prefixes` keeps today's person-scoped query byte for byte. Where `Ticket prefixes` is declared, a separate `issue-list --state inbox` read keeps the reader's own open tickets visible under a new `inbox` field of the issue index, costing one request only when it runs; `waitingOf` now threads that field into *Waiting on you* so an unmatched reader still sees their own tickets, unioned with project rows for a matched one.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
bumps:
  skills:
    plot: minor
-->
