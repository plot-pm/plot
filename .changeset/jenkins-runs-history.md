---
'plot': patch
---

`plot-host.sh runs`'s Jenkins arm now returns actual build history — several entries, newest first, each carrying its own `startedAt` and `url` read from Jenkins' REST API — instead of a one-entry stand-in from `jenkins_build_map` with both fields hard-coded to `""`. It reuses `jenkins_sha_runs`'s existing fetch (now callable unfiltered) rather than adding a second Jenkins HTTP call, and reports `conclusion` host-neutral from Jenkins' raw `.result`, or `in_progress` while a build runs, as the GitHub arm does. On a plain Jenkins job it reports only builds whose recorded branch is the asked one, and a multibranch branch Jenkins has not indexed answers an empty history.

<!--
plan: docs/plans/2026-10-16-the-agent-s-ci-wait-never.md
bumps:
  skills:
    plot: patch
-->
