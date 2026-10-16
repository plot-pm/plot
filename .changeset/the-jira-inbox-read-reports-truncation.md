---
'plot': patch
---

The Jira inbox read now walks pages the way the closed read already does, so a reader with more open tickets than one Jira page gets `complete: false` or every page rather than a silent cap near 100 reported as complete. `issues.json` also records `inboxAt`, the time the inbox was last answered; a tracker that becomes unaskable (no `Ticket prefixes` declared) drops the kept inbox rows and their age, while a failed read keeps both so a reader can derive staleness from the stored time instead of a stored verdict.

<!--
plan: docs/plans/2026-10-16-jira-inbox-and-issue-index.md
bumps:
  skills:
    plot: patch
-->
