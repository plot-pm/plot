---
'plot': patch
---

The fleet scan asks for the check rollup of open pull requests only. `plot-fleet-scan.sh` made one `pr-list --state all --rich` call, which asked GitHub for `statusCheckRollup` on every PR: 957 on this repository, 920 of them merged, and ~37 s of a ~55 s scan. The scan now makes two calls, `--state open --rich` and `--state all` without `--rich`, and drops the second payload's OPEN rows before its rank-and-dedup, so an open PR keeps its rollup. The host verdict is the worse of the two calls, and the list-completeness test counts the `all` payload before that filter.

<!--
plan: docs/plans/2026-09-25-a-merged-pr-is-not-asked-for-its-checks.md
bumps:
  skills:
    plot: patch
-->
