---
'plot': minor
---

A repository can now declare `Sprint owner: plot` to let plot own `/plot-sprint` while `Tracker` names an external issue tracker (e.g. Jira) — previously `Tracker` alone decided both who owns sprints and where issues live, so a Bitbucket-and-Jira repository had no way to get plot sprints without losing its issue list. A repository that declares only `Tracker` is unaffected: the sprint gate's rule is unchanged.

<!--
plan: docs/plans/2026-10-20-plot-on-a-bitbucket-repository-lists.md
bumps:
  skills:
    plot-sprint: minor
-->
