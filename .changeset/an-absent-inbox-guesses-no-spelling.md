---
'@plot-pm/board': patch
---

A no-fleet board now reads the reader's Jira inbox before computing *Waiting on you*, and `waitingTickets` takes how that read ended. An inbox read that failed or was not read answers 0 tickets with a notice saying so, rather than guessing the reader's spelling from the first project-wide assignee and suggesting a `jira:` spelling `People` already declares for someone else. An `unaskable` inbox read — a Jira repo with no `Ticket prefixes`, whose open read is already person-scoped — still shows the open rows as the reader's own. The issue index stores the answer as `inboxAnswer`; a file without it reads the open rows as before.

<!--
plan: docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md
bumps:
  skills:
    plot: patch
-->
