---
'plot': patch
---

`plot-host.sh backend` infers the git host from the `origin` remote where no `Git host` key declares one, and refuses with exit 4 where nothing names a host. It answered `github` unconditionally, so a Bitbucket repository that forgot the key got GitHub's answer and a repository with no remote got one too — the reassuring direction, where nobody investigates a green light.

<!--
plan: docs/sprints/2026-W36-a-half-landed-workflow-says-so.md
bumps:
  skills:
    plot: patch
-->
