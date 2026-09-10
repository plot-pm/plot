---
'plot': minor
---

The Jira issue inbox scopes by project. `plot-host.sh`'s default query scoped by assignee and by resolution and by nothing else, so on a shared instance it was instance-wide — one reporter's board showed twelve issues, of which one belonged to a different customer entirely. A new `Ticket prefixes` config key names the tracker projects a repository's work lives in, and the default query gains `AND project IN (…)` when it is set. The key holds a list, because a repository mapping to several projects is the normal case. A repository that declares no key sends today's query byte for byte, and `PLOT_JIRA_JQL` still overrides both.

<!--
plan: docs/plans/2026-09-09-jira-inbox-is-instance-wide-the.md
bumps:
  skills:
    plot: minor
-->
