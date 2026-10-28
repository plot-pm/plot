---
'@plot-pm/board': patch
---

A no-fleet board now reads the reader's Jira inbox before computing *Waiting on you*, and `waitingTickets` no longer falls back to project-wide rows when that read is absent — it answers 0 tickets with a notice naming the inbox as unread, rather than guessing the reader's spelling from the first assignee it finds and suggesting a `jira:` spelling `People` already declares for someone else.

<!--
plan: docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md
bumps:
  skills:
    plot: patch
-->
