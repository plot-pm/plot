---
'@plot-pm/board': patch
'plot': patch
---

A follow-up issue plot-review cannot open no longer leaves its findings visible only in a local file: the HIGH/MEDIUM/LOW counts and the reviewer's verdict text are now also posted as a PR comment, through a new `Host.prComment` port operation (`plot-host.sh pr-comment`, GitHub only — Bitbucket has no verified comment write and answers unaskable). A comment that fails or cannot be posted prints a line saying the findings were not posted on the PR and naming the local verdict file; the exit code is unchanged. A verdict above 65,536 UTF-8 bytes is cut at a code point, keeping the counts and the run marker.

<!--
plan: docs/plans/2026-10-22-plot-review-cannot-open-its-follow.md
bumps:
  skills:
    plot: patch
-->
