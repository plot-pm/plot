---
'plot': patch
'@plot-pm/board': minor
---

A Discovery ticket card shows the issue's type and its owner. `plot-host.sh issue-list` prints the Jira issue type and the GitHub issue type as `type`, the issue index keeps it on each row, and `ticketLanes` carries `type` and `owner` on each lane row. The type is the tracker's own word, lowercased; the owner is the first assignee resolved through the `People` directory, or shown as written where undeclared. A card whose ticket has neither shows neither.

<!--
plan: docs/plans/2026-10-15-discovery-and-planning-cards-show-the.md
bumps:
  skills:
    plot: patch
-->
