---
'plot': patch
---

`Ticket prefixes` now has one reader: `plot-host.sh ticket-projects` prints the normalised list and honors `PLOT_TICKET_PREFIXES`, and `trackerJira.issueListInbox` and `issueOpen` ask it instead of each spawning their own `plot-config.sh get`. The override now reaches the inbox gate and `issueOpen`'s project pick, which ignored it before. `plot-host.sh issue-open` dispatches on `issue_source` like `issue-list` and `issue-view`, so a tracker with no connector exits 4 with the rule's own reason. An undeclared key still reads as unscoped.

<!--
plan: docs/plans/2026-10-16-jira-inbox-and-issue-index.md
bumps:
  skills:
    plot: patch
-->
