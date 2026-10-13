---
'plot': patch
---

`plot-host.sh issue-list --paged` reads open Jira issues 100 to a page and prints the next page's token as a last line, as the closed read does; an open read without `--paged` prints issue rows alone, as before. `Tracker.issueListOpen` walks those pages up to its limit and reports `complete` and the requests it spent, and `issueListClosed` reports its requests too.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
bumps:
  skills:
    plot: patch
-->
