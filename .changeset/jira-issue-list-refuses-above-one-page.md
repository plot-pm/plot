---
'plot': patch
---

`plot-host.sh issue-list --limit N` on a Jira tracker no longer returns 100 rows with no sign the rest exist when `N` exceeds one page (100) and `--paged` is absent: the open and inbox reads now refuse before any curl, exit 2, naming `--paged`. A closed or changed read, a `--paged` read, `--limit 100`, and no `--limit` all still answer as before.

<!--
plan: docs/plans/2026-10-21-jira-issue-list-limit-above-one.md
bumps:
  skills:
    plot: patch
-->
