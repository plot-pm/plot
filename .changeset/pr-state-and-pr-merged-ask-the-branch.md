---
'plot': patch
---

On Bitbucket, `pr-state`, `pr-merged`, `pr-merge-commit` and `pr-merged-heads` now ask `plot-host.sh` about one branch directly instead of reading a 50-row repository-wide page and filtering locally, so a PR merged before the newest 50 is found rather than read as unmerged; a page that cannot prove absence (a non-miss failure, or a full page with no matching row) answers `unknown` or exits 3 rather than `NONE` / `not-merged`.

<!--
plan: docs/plans/2026-10-20-pr-state-and-pr-merged-miss.md
bumps:
  skills:
    plot: patch
-->
