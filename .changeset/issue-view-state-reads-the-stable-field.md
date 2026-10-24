---
'plot': patch
---

`plot-host.sh issue-view` now reports a closed issue as `closed` on Jira and Bitbucket. Jira reads `statusCategory.key` (`done`) or a set `resolution` instead of the localised category name, and Bitbucket closes on `RESOLVED`, `CLOSED`, `INVALID`, `DUPLICATE` and `WONTFIX`; a leading space in the stripped badge no longer defeats the match. Host tests now assert `state` for all three hosts.

<!--
plan: docs/plans/2026-10-24-tracker-arms-in-plot-host-sh.md
bumps:
  skills:
    plot: patch
-->
