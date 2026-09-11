---
'plot': patch
---

`plot-host.sh backend` infers the git host from the `origin` remote where no `Git host` key declares one, so a Bitbucket repository that forgot the key stops getting GitHub's answer. Where nothing names a host it still answers `github` — six test suites build remote-less repositories that depend on it — but it now says on stderr that the answer was a guess.

<!--
plan: docs/sprints/2026-W36-a-half-landed-workflow-says-so.md
bumps:
  skills:
    plot: patch
-->
