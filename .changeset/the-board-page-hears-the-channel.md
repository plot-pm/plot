---
'@plot-pm/board': minor
---

The board serves `GET /api/events` as a server-sent-event stream fed by one subscription to `.plot/fleet.sock`, at most one event per second, and the page refetches `/api/board` on an event at most once per 2 s; the 30 s poll stays, and with no channel the stream stays silent.

<!--
plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md
bumps:
  skills:
    plot: patch
-->
