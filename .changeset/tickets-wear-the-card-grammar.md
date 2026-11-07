---
'@plot-pm/board': minor
---

The Discovery Tickets lanes render through the shared card, with facts computed on the server, and a ticket opens in a new TicketModal that shows its issue body as text, its plans and stories as links, and its actions. The `⋯` menu's Create plan on Waiting-on-you issue rows now follows the same facts, so it refuses a ticket whose plans or stories the board could not read, where it offered the action before. POST /api/idea re-derives the ticket's stories at click time, refuses `stories-unread` and `linked-from-many-stories`, and puts the one live story's slug above the issue body.

<!--
plan: docs/plans/2026-11-06-one-card-grammar.md
bumps:
  skills:
    plot: patch
-->
