---
'plot': patch
'@plot-pm/board': patch
---

A Bitbucket repository with no external `Tracker` asks no host for its issues. Bitbucket Cloud has kept no issues since 2026-08-20, so `issueSource` answers `nobody`, and the board shows "the git host `bitbucket` has no issue list to read" with the advice to declare the `Tracker` key (or, under `Tracker: plot`, to declare `Tracker: jira <base URL>` with `Sprint owner: plot`). `plot-host.sh issue-list` and `issue-view` exit 4 on Bitbucket without calling `bb`, and the parser for craftamap/bb 0.6.0's `bb issue` text is gone.

<!--
bumps:
  skills:
    plot: patch
-->
