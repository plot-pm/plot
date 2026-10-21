---
'plot': patch
---

`plot-host.sh issue-list --state version --fix-version <name>` for a version Jira has never heard of now refuses with `version-not-found: <name>` (exit 4) before spending a search, instead of exiting 0 with no rows; an unpaged open or inbox read that Jira cut now prints one stderr line naming the row count and limit, with stdout unchanged.

<!--
plan: docs/plans/2026-10-21-jira-issue-list-answers-an-unknown.md
bumps:
  skills:
    plot: patch
-->
