---
'@plot-pm/board': patch
'plot': patch
---

A follow-up issue plot-review cannot open no longer leaves its findings visible only in a local file: the HIGH/MEDIUM/LOW counts and the reviewer's verdict text are now also posted as a PR comment, through a new `Host.prComment` port operation (`plot-host.sh pr-comment`, GitHub only — Bitbucket has no verified comment write and answers unaskable). A failed comment is reported as an informational line; the exit code is unchanged.

<!--
plan: docs/plans/2026-10-22-plot-review-cannot-open-its-follow.md
bumps:
  skills:
    plot: patch
-->
