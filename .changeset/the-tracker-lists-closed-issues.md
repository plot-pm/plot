---
'plot': patch
---

`plot-host.sh issue-list` reads closed issues with `--state closed --since <iso>` and pages Jira with `--page-token`. GitHub searches by close date, Jira reads `resolutiondate` within `Ticket prefixes` and exits 4 without them, and Bitbucket exits 4. `Tracker.issueListClosed` returns them with `Issue.closedAt`, and `unaskable` carries an optional reason.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
bumps:
  skills:
    plot: patch
-->
